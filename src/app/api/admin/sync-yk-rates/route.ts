import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { sheetsApi } from "@/lib/google/google-sheets";
import { normalizeCompanyName } from "@/lib/company-name";

const SPREADSHEET_ID = "1wRscbgsxW62bwa3E2kopHBAgJIsgJvRzb-lHCk5bHDA";
const SHEET_NAME = "★YK추가수수료";

// 시트 컬럼 구조 (스크린샷 기반):
// B: 제약사명 (행 헤더)
// E~M: 거래처별 추가수수료율
//   E:이음, F:서원, G:메디펄스, H:YK, I:에이스, J:엠디파마, K:힐링팜, L:의왕, M:DH홀딩스
const CORP_COLUMNS: Array<{ col: string; name: string }> = [
  { col: "E", name: "이음" },
  { col: "F", name: "서원" },
  { col: "G", name: "메디펄스" },
  { col: "H", name: "YK" },
  { col: "I", name: "에이스" },
  { col: "J", name: "엠디파마" },
  { col: "K", name: "힐링팜" },
  { col: "L", name: "의왕" },
  { col: "M", name: "DH홀딩스" },
];

const COMPANY_COL = "B";
const HEADER_ROW = 2; // 헤더는 2행, 데이터는 3행부터
const DATA_RANGE = `${SHEET_NAME}!${COMPANY_COL}3:M`;

interface SyncResult {
  totalRows: number;
  upserted: number;
  skipped: number;
  errors: string[];
}

export async function POST(_req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  try {
    const encodedRange = encodeURIComponent(DATA_RANGE);
    const data = await sheetsApi(`/${SPREADSHEET_ID}/values/${encodedRange}`) as {
      values?: string[][];
    };
    const rows = data.values ?? [];

    // 시트 별명 → 실제 법인명 매핑 로드
    const mappings = await prisma.sheetCorpMapping.findMany({
      where: { active: true },
      include: { userClient: { select: { clientName: true } } },
    });
    const labelToCorp = new Map<string, string>();
    for (const m of mappings) {
      if (m.userClient?.clientName) {
        labelToCorp.set(m.sheetLabel, m.userClient.clientName);
      }
    }

    // 시트 제약사명 → KMD 전산 제약사명 매핑 로드
    const companyMappings = await prisma.sheetCompanyMapping.findMany({ where: { active: true } });
    const sheetToKmd = new Map(companyMappings.map((m) => [m.sheetCompany, m.kmdCompany]));

    const result: SyncResult = { totalRows: rows.length, upserted: 0, skipped: 0, errors: [] };
    const unmappedLabels = new Set<string>();
    const unmappedCompanies = new Set<string>();

    for (const row of rows) {
      const companyRaw = (row[0] ?? "").trim();
      if (!companyRaw) {
        result.skipped++;
        continue;
      }
      // 명시적 매핑 우선, 없으면 정규화 fallback
      const companyName = sheetToKmd.get(companyRaw) ?? normalizeCompanyName(companyRaw);
      if (!sheetToKmd.has(companyRaw)) unmappedCompanies.add(companyRaw);
      if (!companyName) {
        result.skipped++;
        continue;
      }

      // E열이 row[3] (B=0, C=1, D=2, E=3)
      for (let i = 0; i < CORP_COLUMNS.length; i++) {
        const cellIdx = 3 + i;
        const raw = (row[cellIdx] ?? "").trim();
        if (!raw) continue;
        const rate = Number(raw);
        if (!Number.isFinite(rate)) {
          result.errors.push(`${companyRaw} / ${CORP_COLUMNS[i].name}: 숫자 아님 (${raw})`);
          continue;
        }
        const sheetLabel = CORP_COLUMNS[i].name;
        const corpName = labelToCorp.get(sheetLabel);
        if (!corpName) {
          unmappedLabels.add(sheetLabel);
          result.skipped++;
          continue;
        }
        try {
          await prisma.corpCompanyRate.upsert({
            where: { corpName_companyName: { corpName, companyName } },
            update: { additionalRate: rate, memo: `시트 자동 동기화 — ${SHEET_NAME} (${sheetLabel})` },
            create: { corpName, companyName, additionalRate: rate, memo: `시트 자동 동기화 — ${SHEET_NAME} (${sheetLabel})` },
          });
          result.upserted++;
        } catch (err) {
          result.errors.push(`${companyName} / ${corpName}: ${(err as Error).message}`);
        }
      }
    }

    return NextResponse.json({
      ...result,
      unmappedLabels: [...unmappedLabels],
      unmappedCompanies: [...unmappedCompanies],
    });
  } catch (err) {
    console.error("[sync-yk-rates]", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "시트 동기화 실패" },
      { status: 500 },
    );
  }
}
