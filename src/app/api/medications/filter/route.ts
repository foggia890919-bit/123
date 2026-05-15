import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompanyKey } from "@/lib/utils";
import { safeParseInt } from "@/lib/auth-guard";
import { buildRateMap } from "@/lib/rate-utils";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const companiesParam = req.nextUrl.searchParams.get("companies") || "";
  const userId = req.nextUrl.searchParams.get("userId") || null;
  const settlementType = req.nextUrl.searchParams.get("settlementType") || "";

  const allSettlement = req.nextUrl.searchParams.get("isSettlement") === "true";
  const companyList = companiesParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (companyList.length === 0 && !allSettlement) return NextResponse.json({ medications: [], total: 0 });

  const where: Record<string, unknown> = {};
  if (allSettlement) {
    where.isSettlement = true;
  } else {
    where.companyName = { in: companyList };
  }
  if (settlementType === "원외" || settlementType === "원내") {
    where.settlementType = settlementType;
  }

  if (q && q.trim() !== " ") {
    where.OR = [
      { productName: { contains: q, mode: "insensitive" } },
      { ingredientName: { contains: q, mode: "insensitive" } },
      { insuranceCode: { contains: q, mode: "insensitive" } },
    ];
  }

  const take = allSettlement
    ? safeParseInt(req.nextUrl.searchParams.get("limit"), 100_000, 1, 200_000)
    : safeParseInt(req.nextUrl.searchParams.get("limit"), 200, 1, 1000);
  const skip = safeParseInt(req.nextUrl.searchParams.get("skip"), 0, 0, 1_000_000);

  const [medications, total] = await Promise.all([
    prisma.medication.findMany({
      where,
      orderBy: [{ isSettlement: "desc" }, { commissionRate: "desc" }, { companyName: "asc" }, { source: "asc" }],
      take,
      skip,
    }),
    prisma.medication.count({ where }),
  ]);

  // 전체 요율표 다운로드 시 동일 보험코드 중복 제거 (EXCEL 우선, 없으면 PUBLIC_API)
  let result_medications = medications;
  if (allSettlement) {
    const seen = new Set<string>();
    result_medications = medications.filter((m) => {
      const key = m.insuranceCode ? m.insuranceCode.trim() : `__nk_${m.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const rateMap = userId ? await buildRateMap(userId) : {};

  const result = result_medications.map((med) => ({
    ...med,
    additionalRate: rateMap[normalizeCompanyKey(med.companyName)] ?? null,
  }));

  return NextResponse.json({ medications: result, total: result.length });
}
