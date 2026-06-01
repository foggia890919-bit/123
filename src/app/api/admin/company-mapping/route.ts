import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { sheetsApi } from "@/lib/google/google-sheets";
import { companyNameKey } from "@/lib/company-name";

const SPREADSHEET_ID = "1wRscbgsxW62bwa3E2kopHBAgJIsgJvRzb-lHCk5bHDA";
const SHEET_NAME = "★YK추가수수료";
const COMPANY_RANGE = `${SHEET_NAME}!B3:B`;

interface MappingItem {
  sheetCompany: string;
  kmdCompany: string | null;   // 확정 매핑
  suggested: string | null;     // 자동 제안 (정규화 키 일치)
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
  const kmdKeyMap = new Map<string, string>(); // 정규화키 → 원본
  for (const c of kmdCompanies) kmdKeyMap.set(companyNameKey(c), c);

  // 3) 기존 매핑
  const existing = await prisma.sheetCompanyMapping.findMany();
  const existingMap = new Map(existing.map((m) => [m.sheetCompany, m.kmdCompany]));

  // 4) 항목 조립
  const items: MappingItem[] = sheetCompanies.map((sheetCompany) => {
    const confirmed = existingMap.get(sheetCompany) ?? null;
    const suggested = confirmed ? null : (kmdKeyMap.get(companyNameKey(sheetCompany)) ?? null);
    return {
      sheetCompany,
      kmdCompany: confirmed,
      suggested,
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
  const kmdKeyMap = new Map<string, string>();
  for (const r of kmdRows) if (r.companyName) kmdKeyMap.set(companyNameKey(r.companyName), r.companyName);

  let count = 0;
  for (const sheetCompany of sheetCompanies) {
    const match = kmdKeyMap.get(companyNameKey(sheetCompany));
    if (!match) continue;
    await prisma.sheetCompanyMapping.upsert({
      where: { sheetCompany },
      update: { kmdCompany: match },
      create: { sheetCompany, kmdCompany: match },
    });
    count++;
  }
  return NextResponse.json({ ok: true, autoMatched: count });
}
