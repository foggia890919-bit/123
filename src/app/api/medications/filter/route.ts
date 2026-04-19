import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompanyKey } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const companiesParam = req.nextUrl.searchParams.get("companies") || "";
  const userId = req.nextUrl.searchParams.get("userId") || null;
  const settlementType = req.nextUrl.searchParams.get("settlementType") || "";

  const companyList = companiesParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (companyList.length === 0) return NextResponse.json({ medications: [], total: 0 });

  const where: Record<string, unknown> = {
    companyName: { in: companyList },
  };
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

  const [medications, total] = await Promise.all([
    prisma.medication.findMany({
      where,
      orderBy: [{ isSettlement: "desc" }, { commissionRate: "desc" }, { companyName: "asc" }],
      take: 200,
    }),
    prisma.medication.count({ where }),
  ]);

  const rateMap: Record<string, number> = {};
  if (userId) {
    const rates = await prisma.memberCompanyRate.findMany({ where: { userId } });
    for (const r of rates) {
      rateMap[normalizeCompanyKey(r.companyName)] = r.additionalRate;
    }
  }

  const result = medications.map((med) => ({
    ...med,
    additionalRate: rateMap[normalizeCompanyKey(med.companyName)] ?? null,
  }));

  return NextResponse.json({ medications: result, total });
}
