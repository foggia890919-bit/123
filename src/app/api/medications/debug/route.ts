import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

// 진단용: DB에 특정 약품이 어떻게 저장돼 있는지 모든 필드·중복까지 표시
// 사용: /api/medications/debug?q=에어페낙
export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
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
      ingredientCode: true,
      commissionRate: true,
      source: true,
      isSettlement: true,
      settlementType: true,
      updatedAt: true,
    },
    orderBy: [{ productName: "asc" }, { source: "asc" }],
  });

  // ingredientCode가 있는 첫 번째 row로 동일성분 전체 카운트 조회
  const sampleCode = rows.find((r) => r.ingredientCode)?.ingredientCode ?? null;
  const sameIngredientCount = sampleCode
    ? await prisma.medication.count({ where: { ingredientCode: sampleCode } })
    : null;

  // 동일 제품명(ingredientName)에서 ingredientCode가 null인 항목 조회
  const nullCodeRows = rows
    .filter((r) => r.ingredientCode === null)
    .map((r) => ({ id: r.id, productName: r.productName, companyName: r.companyName, insuranceCode: r.insuranceCode, source: r.source }));

  return NextResponse.json({
    q,
    total: rows.length,
    rows,
    ingredientCodeBreakdown: {
      sampleIngredientCode: sampleCode,
      totalWithSameCode: sameIngredientCount,
      withCode: rows.filter((r) => r.ingredientCode !== null).length,
      withoutCode: rows.filter((r) => r.ingredientCode === null).length,
      nullCodeItems: nullCodeRows,
    },
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
