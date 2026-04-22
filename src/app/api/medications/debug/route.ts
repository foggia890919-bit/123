import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// 진단용: DB에 특정 약품이 어떻게 저장돼 있는지 모든 필드·중복까지 표시
// 사용: /api/medications/debug?q=에어페낙
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  if (!q) return NextResponse.json({ error: "q 파라미터 필요" }, { status: 400 });

  const rows = await prisma.medication.findMany({
    where: {
      OR: [
        { productName: { contains: q, mode: "insensitive" } },
        { ingredientName: { contains: q, mode: "insensitive" } },
        { insuranceCode: { contains: q } },
      ],
    },
    select: {
      id: true,
      productName: true,
      ingredientName: true,
      companyName: true,
      insuranceCode: true,
      commissionRate: true,
      source: true,
      isSettlement: true,
      settlementType: true,
      updatedAt: true,
    },
    orderBy: [{ productName: "asc" }, { source: "asc" }],
  });

  return NextResponse.json({
    q,
    total: rows.length,
    rows,
    summary: {
      withRate: rows.filter((r) => r.commissionRate !== null).length,
      withoutRate: rows.filter((r) => r.commissionRate === null).length,
      bySource: {
        PUBLIC_API: rows.filter((r) => r.source === "PUBLIC_API").length,
        EXCEL: rows.filter((r) => r.source === "EXCEL").length,
      },
    },
  });
}
