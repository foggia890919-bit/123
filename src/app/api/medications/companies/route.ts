import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// 쿼리 파라미터:
// - type: "원외" | "원내" | "settlement" | "all"
//   - 원외: settlementType="원외" 약품이 있는 제약사
//   - 원내: settlementType="원내" 약품이 있는 제약사
//   - settlement: isSettlement=true 약품이 있는 제약사 (원외+원내 합집합)
//   - all: 모든 제약사
// - default: settlement (기존 필터링 페이지 호환)
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") || "settlement";

  if (type === "all") {
    const [outRows, inRows, allRows] = await Promise.all([
      prisma.medication.groupBy({
        by: ["companyName"],
        where: { settlementType: "원외" },
        _count: { id: true },
      }),
      prisma.medication.groupBy({
        by: ["companyName"],
        where: { settlementType: "원내" },
        _count: { id: true },
      }),
      prisma.medication.groupBy({
        by: ["companyName"],
        _count: { id: true },
        orderBy: { companyName: "asc" },
      }),
    ]);
    const outSet = new Set(outRows.map((c) => c.companyName));
    const inSet = new Set(inRows.map((c) => c.companyName));
    return NextResponse.json(
      allRows.map((c) => ({
        name: c.companyName,
        isSettlement: outSet.has(c.companyName) || inSet.has(c.companyName),
        hasOutpatient: outSet.has(c.companyName),
        hasInpatient: inSet.has(c.companyName),
        count: c._count.id,
      }))
    );
  }

  const where =
    type === "원외" ? { settlementType: "원외" } :
    type === "원내" ? { settlementType: "원내" } :
    { isSettlement: true };

  const companies = await prisma.medication.groupBy({
    by: ["companyName"],
    where,
    _count: { id: true },
    orderBy: { companyName: "asc" },
  });

  return NextResponse.json(
    companies.map((c) => ({
      name: c.companyName,
      isSettlement: true,
      count: c._count.id,
    }))
  );
}
