import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompanyKey } from "@/lib/utils";
import { safeParseInt } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const ingredientCodeParam = req.nextUrl.searchParams.get("ingredientCode")?.trim() || "";
  const settlementOnly = req.nextUrl.searchParams.get("settlement") === "true";
  const userId = req.nextUrl.searchParams.get("userId") || null;
  const page = safeParseInt(req.nextUrl.searchParams.get("page"), 1, 1, 10000);
  const limit = safeParseInt(req.nextUrl.searchParams.get("limit"), 50, 1, 200);
  const ingredientOnly = req.nextUrl.searchParams.get("ingredientOnly") === "true";
  const companiesRaw = req.nextUrl.searchParams.get("companies") || "";
  const companyList = companiesRaw.split(",").map((s) => s.trim()).filter(Boolean);

  if (!q && !ingredientCodeParam && companyList.length === 0) return NextResponse.json({ medications: [], total: 0 });

  const where = {
    AND: [
      settlementOnly ? { isSettlement: true } : {},
      companyList.length > 0 ? { companyName: { in: companyList } } : {},
      ingredientCodeParam
        ? { ingredientCode: ingredientCodeParam }
        : q
          ? ingredientOnly
            ? { ingredientName: { contains: q, mode: "insensitive" as const } }
            : {
                OR: [
                  { productName: { contains: q, mode: "insensitive" as const } },
                  { ingredientName: { contains: q, mode: "insensitive" as const } },
                  { companyName: { contains: q, mode: "insensitive" as const } },
                  { insuranceCode: { contains: q, mode: "insensitive" as const } },
                ],
              }
          : {},
    ],
  };

  const [medications, total] = await Promise.all([
    prisma.medication.findMany({
      where,
      orderBy: [{ isSettlement: "desc" }, { commissionRate: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.medication.count({ where }),
  ]);

  // 로그인 회원의 추가수수료 적용 — 제약사명은 (주)/공백 무시하고 정규화 키로 매칭
  let rateMap: Record<string, number> = {};
  if (userId) {
    const rates = await prisma.memberCompanyRate.findMany({ where: { userId } });
    for (const r of rates) {
      rateMap[normalizeCompanyKey(r.companyName)] = r.additionalRate;
    }
  }

  const result = medications.map((med) => ({
    ...med,
    additionalRate: rateMap[normalizeCompanyKey(med.companyName)] ?? null,
  })) as Array<typeof medications[number] & { additionalRate: number | null; stock?: number | null }>;

  const insuranceCodes = result.map((m) => m.insuranceCode).filter((c): c is string => !!c);
  if (insuranceCodes.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ insuranceCode: string; stock: number }>>`
      SELECT DISTINCT ON ("siteKey", "insuranceCode")
             "insuranceCode",
             COALESCE("stock", 0)::int AS stock
      FROM "InventorySnapshot"
      WHERE "insuranceCode" = ANY(${insuranceCodes}::text[])
        AND "siteKey" IN ('ibjp', 'family')
        AND "scrapedAt" > NOW() - INTERVAL '7 days'
      ORDER BY "siteKey", "insuranceCode", "scrapedAt" DESC
    `;
    const stockByCode = new Map<string, number>();
    for (const r of rows) {
      stockByCode.set(r.insuranceCode, (stockByCode.get(r.insuranceCode) ?? 0) + Number(r.stock));
    }
    for (const m of result) {
      if (m.insuranceCode && stockByCode.has(m.insuranceCode)) {
        m.stock = stockByCode.get(m.insuranceCode)!;
      }
    }
  }

  return NextResponse.json({ medications: result, total });
}
