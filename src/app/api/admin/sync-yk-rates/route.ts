import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { sheetsApi } from "@/lib/google/google-sheets";
import { normalizeCompanyName } from "@/lib/company-name";

const SPREADSHEET_ID = "1wRscbgsxW62bwa3E2kopHBAgJIsgJvRzb-lHCk5bHDA";
const SHEET_NAME = "★YK추가수수료";

// 시트 컬럼 구조 (사용자 정정 후):
// B: 제약사명 (행 헤더)
// C: 최고요율 (★ 우리 프로모션이 적용하는 요율 ★)
// D: 최고요율업체 (참고용 — 메모로 저장)
// E~M, N~Q: 무시
const COMPANY_COL = "B";
const DATA_RANGE = `${SHEET_NAME}!${COMPANY_COL}3:D`;

// 협력법인 모든 곳에 동일하게 적용하는 글로벌 요율의 corpName 키
export const GLOBAL_PROMO_CORP_KEY = "_GLOBAL_PROMO_";

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

    // 시트 제약사명 → KMD 전산 제약사명 매핑 (★ 이게 핵심 ★)
    const companyMappings = await prisma.sheetCompanyMapping.findMany({ where: { active: true } });
    const sheetToKmd = new Map(companyMappings.map((m) => [m.sheetCompany, m.kmdCompany]));

    const result: SyncResult = { totalRows: rows.length, upserted: 0, skipped: 0, errors: [] };
    const unmappedCompanies = new Set<string>();

    for (const row of rows) {
      const companyRaw = (row[0] ?? "").trim();
      if (!companyRaw) { result.skipped++; continue; }

      // 명시적 매핑 우선, 없으면 정규화 fallback
      const explicitMapping = sheetToKmd.get(companyRaw);
      const companyName = explicitMapping ?? normalizeCompanyName(companyRaw);
      if (!explicitMapping) unmappedCompanies.add(companyRaw);
      if (!companyName) { result.skipped++; continue; }

      // C열 = 최고요율
      const maxRateRaw = (row[1] ?? "").trim();
      if (!maxRateRaw) { result.skipped++; continue; }
      const maxRate = Number(maxRateRaw);
      if (!Number.isFinite(maxRate)) {
        result.errors.push(`${companyRaw}: 최고요율 숫자 아님 (${maxRateRaw})`);
        continue;
      }

      // D열 = 최고요율업체 (참고)
      const maxChannel = (row[2] ?? "").trim();

      try {
        await prisma.corpCompanyRate.upsert({
          where: { corpName_companyName: { corpName: GLOBAL_PROMO_CORP_KEY, companyName } },
          update: {
            additionalRate: maxRate,
            memo: `시트 ${SHEET_NAME} 최고요율${maxChannel ? ` · ${maxChannel}` : ""}`,
          },
          create: {
            corpName: GLOBAL_PROMO_CORP_KEY,
            companyName,
            additionalRate: maxRate,
            memo: `시트 ${SHEET_NAME} 최고요율${maxChannel ? ` · ${maxChannel}` : ""}`,
          },
        });
        result.upserted++;
      } catch (err) {
        result.errors.push(`${companyName}: ${(err as Error).message}`);
      }
    }

    return NextResponse.json({
      ...result,
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
