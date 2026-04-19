import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const settlementOnly = req.nextUrl.searchParams.get("settlement") === "true";
  const userId = req.nextUrl.searchParams.get("userId") || null;
  const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
  const limit = 50;

  if (!q) return NextResponse.json({ medications: [], total: 0 });

  const where = {
    AND: [
      settlementOnly ? { isSettlement: true } : {},
      {
        OR: [
          { productName: { contains: q, mode: "insensitive" as const } },
          { ingredientName: { contains: q, mode: "insensitive" as const } },
          { companyName: { contains: q, mode: "insensitive" as const } },
          { insuranceCode: { contains: q, mode: "insensitive" as const } },
        ],
      },
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

  // 로그인 회원의 추가수수료 적용
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
