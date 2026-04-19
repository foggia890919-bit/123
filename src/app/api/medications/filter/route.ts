import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const companiesParam = req.nextUrl.searchParams.get("companies") || "";
  const userId = req.nextUrl.searchParams.get("userId") || null;

  const companyList = companiesParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (companyList.length === 0) return NextResponse.json({ medications: [], total: 0 });

  const where: Record<string, unknown> = {
    companyName: { in: companyList },
  };

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

  let rateMap: Record<string, number> = {};
  if (userId) {
    const rates = await prisma.memberCompanyRate.findMany({ where: { userId } });
    rateMap = Object.fromEntries(rates.map((r) => [r.companyName, r.additionalRate]));
  }

  const result = medications.map((med) => ({
    ...med,
    additionalRate: rateMap[med.companyName] ?? null,
  }));

  return NextResponse.json({ medications: result, total });
}
