import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const settlementOnly = req.nextUrl.searchParams.get("settlement") === "true";
  const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
  const limit = 50;

  if (!q) {
    return NextResponse.json({ medications: [], total: 0 });
  }

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

  return NextResponse.json({ medications, total });
}
