import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompanyKey } from "@/lib/utils";
import { buildRateMap } from "@/lib/rate-utils";

function normalizeCode(code: string): string {
  const cleaned = code.replace(/[\s\-]/g, "").toUpperCase();
  if (/^\d{1,8}$/.test(cleaned)) return cleaned.padStart(9, "0");
  return cleaned;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MedRow = Record<string, any>;

// 엑셀 A열 보험코드 목록 → 매칭된 약품 정보 반환
// PUBLIC_API 매칭 시: 요율표(EXCEL) 대체품을 autoSelected로 함께 반환
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

  // 동일 보험코드에 여러 레코드 있을 수 있음 — 모두 수집
  const idsByNormalized = new Map<string, string[]>();
  for (const r of matchRows) {
    if (!idsByNormalized.has(r.matched)) idsByNormalized.set(r.matched, []);
    idsByNormalized.get(r.matched)!.push(r.id);
  }

  const allIds = Array.from(new Set(matchRows.map((r: { id: string; matched: string }) => r.id)));
  const allMeds = await prisma.medication.findMany(
    allIds.length > 0 ? { where: { id: { in: allIds } } } : { where: { id: "" } }
  );
  const medById = new Map<string, typeof allMeds[0]>();
  for (const m of allMeds) medById.set(m.id, m);

  const rateMap = userId ? await buildRateMap(userId) : {};

  // 정규화 코드별 best 매칭 선택
  // 우선순위: EXCEL + commissionRate 있음 > EXCEL > PUBLIC_API + commissionRate > PUBLIC_API
  const medByNormalized = new Map<string, MedRow>();
  for (const [nk, ids] of idsByNormalized) {
    const candidates = ids.map((id) => medById.get(id)).filter((m): m is MedRow => m != null);

    const pick =
      candidates.find((m) => m.source === "EXCEL" && m.commissionRate != null) ??
      candidates.find((m) => m.source === "EXCEL") ??
      candidates.find((m) => m.commissionRate != null) ??
      candidates[0];

    if (pick) medByNormalized.set(nk, pick);
  }

  // PUBLIC_API 매칭(수수료 없음) → 요율표(EXCEL) 최고 수수료 대체품 자동 선택
  const publicMatches = Array.from(medByNormalized.values()).filter(
    (m) => m.source === "PUBLIC_API" || m.commissionRate == null
  );
  const ingredientCodes = [
    ...new Set(publicMatches.map((m) => m.ingredientCode).filter(Boolean) as string[]),
  ];

  const bestExcelByIngredient = new Map<string, MedRow>();
  if (ingredientCodes.length > 0) {
    const excelAlts = await prisma.medication.findMany({
      where: {
        ingredientCode: { in: ingredientCodes },
        source: "EXCEL",
        commissionRate: { not: null },
      },
    });

    for (const med of excelAlts) {
      if (!med.ingredientCode) continue;
      const ic = med.ingredientCode;
      const current = bestExcelByIngredient.get(ic);
      const newTotal = (med.commissionRate ?? 0) + (rateMap[normalizeCompanyKey(med.companyName)] ?? 0);
      const curTotal = current
        ? (current.commissionRate ?? 0) + (rateMap[normalizeCompanyKey(current.companyName)] ?? 0)
        : -Infinity;
      if (newTotal > curTotal) bestExcelByIngredient.set(ic, med);
    }
  }

  // 입력 순서 유지 — 중복 코드도 각 행으로
  const rows = (codes as unknown[])
    .map((c) => String(c ?? "").trim())
    .filter(Boolean)
    .map((code) => {
      const nk = normalizeCode(code);
      const med = medByNormalized.get(nk) ?? null;

      if (!med) return { code, medication: null, autoSelected: null };

      const additionalRate = rateMap[normalizeCompanyKey(med.companyName)] ?? null;
      const medication = { ...med, additionalRate };

      // PUBLIC_API 또는 수수료 없는 매칭 → 요율표 최고 대체품 제공
      let autoSelected: MedRow | null = null;
      if ((med.source === "PUBLIC_API" || med.commissionRate == null) && med.ingredientCode) {
        const best = bestExcelByIngredient.get(med.ingredientCode);
        if (best) {
          autoSelected = { ...best, additionalRate: rateMap[normalizeCompanyKey(best.companyName)] ?? null };
        }
      }

      return { code, medication, autoSelected };
    });

  return NextResponse.json({ rows });
}
