import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompanyKey } from "@/lib/utils";

function normalizeCode(code: string): string {
  const cleaned = code.replace(/[\s\-]/g, "").toUpperCase();
  // 보험코드는 9자리. 엑셀에서 leading 0이 사라져 8자리 이하 숫자로 들어오면 9자리로 zero-pad
  if (/^\d{1,8}$/.test(cleaned)) return cleaned.padStart(9, "0");
  return cleaned;
}

// 엑셀 A열 보험코드 목록 → 매칭된 약품 정보 반환
// 대량등록 페이지에서 "기존품목" 조회용
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const codes = Array.isArray(body?.codes) ? (body.codes as unknown[]) : [];
  const userId = typeof body?.userId === "string" ? body.userId : null;

  const normalizedCodes = Array.from(
    new Set(
      codes
        .map((c) => String(c ?? "").trim())
        .filter(Boolean)
        .map((c) => normalizeCode(c))
    )
  );

  if (normalizedCodes.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  // DB 의 insuranceCode 가 "A,B,C" 형태로 여러 EDI 를 담을 수 있으므로
  // UNNEST + 정규화(하이픈·공백·탭 제거) 비교로 어떤 코드든 매칭
  const matchRows = await prisma.$queryRaw<
    { id: string; matched: string }[]
  >`
    SELECT m.id,
           UPPER(REPLACE(REPLACE(REPLACE(TRIM(code), '-', ''), ' ', ''), E'\t', '')) AS matched
    FROM "Medication" m,
         UNNEST(string_to_array(m."insuranceCode", ',')) AS code
    WHERE m."insuranceCode" IS NOT NULL
      AND UPPER(REPLACE(REPLACE(REPLACE(TRIM(code), '-', ''), ' ', ''), E'\t', '')) = ANY(${normalizedCodes})
  `;

  // 같은 정규화 코드에 여러 레코드가 붙으면 첫 번째만 사용
  const idByNormalized = new Map<string, string>();
  for (const r of matchRows) {
    if (!idByNormalized.has(r.matched)) idByNormalized.set(r.matched, r.id);
  }

  const ids = Array.from(new Set(idByNormalized.values()));
  const meds = ids.length > 0
    ? await prisma.medication.findMany({ where: { id: { in: ids } } })
    : [];
  const medById = new Map(meds.map((m) => [m.id, m]));

  // 추가수수료 맵
  const rateMap: Record<string, number> = {};
  if (userId) {
    const rates = await prisma.memberCompanyRate.findMany({ where: { userId } });
    for (const r of rates) rateMap[normalizeCompanyKey(r.companyName)] = r.additionalRate;
  }

  // 입력 순서 유지, 중복 보험코드도 동일 품목으로 매칭
  const seen = new Set<string>();
  const rows = (codes as unknown[])
    .map((c) => String(c ?? "").trim())
    .filter(Boolean)
    .filter((c) => {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    })
    .map((code) => {
      const nk = normalizeCode(code);
      const id = idByNormalized.get(nk);
      const med = id ? medById.get(id) ?? null : null;
      const medication = med
        ? { ...med, additionalRate: rateMap[normalizeCompanyKey(med.companyName)] ?? null }
        : null;
      return { code, medication };
    });

  return NextResponse.json({ rows });
}
