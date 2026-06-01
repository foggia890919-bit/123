import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { sheetsApi } from "@/lib/google/google-sheets";
import { companyNameKey, companyNamePrefixKey } from "@/lib/company-name";

const SPREADSHEET_ID = "1wRscbgsxW62bwa3E2kopHBAgJIsgJvRzb-lHCk5bHDA";
const SHEET_NAME = "★YK추가수수료";
const COMPANY_RANGE = `${SHEET_NAME}!B3:B`;

interface MappingItem {
  sheetCompany: string;
  kmdCompany: string | null;     // 확정 매핑
  suggested: string | null;       // 단일 자동 제안 (정규화 키 일치, 즉 안전한 매칭)
  candidates: string[];           // 다중 후보 (prefix 키 일치 — 사용자 선택 필요)
  matched: boolean;
}

// GET /api/admin/company-mapping
// 시트 B열 제약사 목록 + 기존 매핑 + 자동매칭 제안 + KMD 제약사 후보 반환
export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  // 1) 시트 제약사명 목록
  let sheetCompanies: string[] = [];
  try {
    const data = await sheetsApi(`/${SPREADSHEET_ID}/values/${encodeURIComponent(COMPANY_RANGE)}`) as { values?: string[][] };
    sheetCompanies = (data.values ?? [])
      .map((r) => (r[0] ?? "").trim())
      .filter((v) => v.length > 0);
    sheetCompanies = [...new Set(sheetCompanies)];
  } catch (err) {
    return NextResponse.json({ error: `시트 읽기 실패: ${(err as Error).message}` }, { status: 500 });
  }

  // 2) KMD 전산 제약사 목록 (distinct)
  const kmdRows = await prisma.medication.findMany({
    where: { companyName: { not: "" } },
    select: { companyName: true },
    distinct: ["companyName"],
    orderBy: { companyName: "asc" },
  });
  const kmdCompanies = [...new Set(kmdRows.map((r) => r.companyName).filter(Boolean))] as string[];

  // 인덱스 두 개:
  // - strictMap: 정규화 키 (회사형태/괄호만 제거)  → 유일 매칭 = 안전
  // - prefixIndex: prefix 키 (제약/약품 접미어 추가 제거)  → 다중 후보 가능
  const kmdStrictMap = new Map<string, string>(); // key → name (유일 보장)
  const kmdPrefixIndex = new Map<string, string[]>(); // key → name[] (여러 개 가능)
  for (const c of kmdCompanies) {
    kmdStrictMap.set(companyNameKey(c), c);
    const pk = companyNamePrefixKey(c);
    if (!kmdPrefixIndex.has(pk)) kmdPrefixIndex.set(pk, []);
    kmdPrefixIndex.get(pk)!.push(c);
  }

  // 3) 기존 매핑
  const existing = await prisma.sheetCompanyMapping.findMany();
  const existingMap = new Map(existing.map((m) => [m.sheetCompany, m.kmdCompany]));

  // 4) 항목 조립
  const items: MappingItem[] = sheetCompanies.map((sheetCompany) => {
    const confirmed = existingMap.get(sheetCompany) ?? null;
    let suggested: string | null = null;
    let candidates: string[] = [];

    if (!confirmed) {
      // 1순위: 정규화 키 정확 일치 → 단일 안전 제안
      const strictHit = kmdStrictMap.get(companyNameKey(sheetCompany));
      if (strictHit) {
        suggested = strictHit;
      } else {
        // 2순위: prefix 키 일치 → 후보 여러 개 (사용자 선택)
        candidates = kmdPrefixIndex.get(companyNamePrefixKey(sheetCompany)) ?? [];
        // 후보가 정확히 1개면 안전한 제안으로 승격 (정규화 키 다른 경우는 없으므로)
        if (candidates.length === 1) {
          suggested = candidates[0];
          candidates = [];
        }
      }
    }

    return {
      sheetCompany,
      kmdCompany: confirmed,
      suggested,
      candidates,
      matched: !!confirmed,
    };
  });

  return NextResponse.json({ items, kmdCompanies });
}

// POST /api/admin/company-mapping → 매핑 저장 (단건)
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const body = await req.json().catch(() => null);
  const sheetCompany = typeof body?.sheetCompany === "string" ? body.sheetCompany.trim() : "";
  const kmdCompany = typeof body?.kmdCompany === "string" ? body.kmdCompany.trim() : "";
  if (!sheetCompany) return NextResponse.json({ error: "sheetCompany 필수" }, { status: 400 });

  if (!kmdCompany) {
    // 빈 값이면 매핑 삭제
    await prisma.sheetCompanyMapping.deleteMany({ where: { sheetCompany } });
    return NextResponse.json({ ok: true, deleted: true });
  }

  const row = await prisma.sheetCompanyMapping.upsert({
    where: { sheetCompany },
    update: { kmdCompany },
    create: { sheetCompany, kmdCompany },
  });
  return NextResponse.json(row);
}

// POST 자동매칭 일괄저장: ?auto=1 → suggested 전부 확정
export async function PUT() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  // 자동 제안을 일괄 확정
  const data = await sheetsApi(`/${SPREADSHEET_ID}/values/${encodeURIComponent(COMPANY_RANGE)}`) as { values?: string[][] };
  const sheetCompanies = [...new Set((data.values ?? []).map((r) => (r[0] ?? "").trim()).filter(Boolean))];

  const kmdRows = await prisma.medication.findMany({
    where: { companyName: { not: "" } },
    select: { companyName: true },
    distinct: ["companyName"],
  });
  const kmdStrictMap = new Map<string, string>();
  const kmdPrefixIndex = new Map<string, string[]>();
  for (const r of kmdRows) {
    if (!r.companyName) continue;
    kmdStrictMap.set(companyNameKey(r.companyName), r.companyName);
    const pk = companyNamePrefixKey(r.companyName);
    if (!kmdPrefixIndex.has(pk)) kmdPrefixIndex.set(pk, []);
    kmdPrefixIndex.get(pk)!.push(r.companyName);
  }

  let strictCount = 0;     // 정규화 키 정확 일치
  let singleCount = 0;     // prefix 매칭 후보 1개라 자동 확정
  let ambiguousCount = 0;  // prefix 후보 2개+ — 사용자 선택 대기
  for (const sheetCompany of sheetCompanies) {
    const strict = kmdStrictMap.get(companyNameKey(sheetCompany));
    if (strict) {
      await prisma.sheetCompanyMapping.upsert({
        where: { sheetCompany },
        update: { kmdCompany: strict },
        create: { sheetCompany, kmdCompany: strict },
      });
      strictCount++;
      continue;
    }
    const candidates = kmdPrefixIndex.get(companyNamePrefixKey(sheetCompany)) ?? [];
    if (candidates.length === 1) {
      await prisma.sheetCompanyMapping.upsert({
        where: { sheetCompany },
        update: { kmdCompany: candidates[0] },
        create: { sheetCompany, kmdCompany: candidates[0] },
      });
      singleCount++;
    } else if (candidates.length > 1) {
      ambiguousCount++;
    }
  }
  return NextResponse.json({
    ok: true,
    autoMatched: strictCount + singleCount,
    strictCount,
    singleCount,
    ambiguousCount,
  });
}
