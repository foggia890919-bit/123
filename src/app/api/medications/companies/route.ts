import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const filter = req.nextUrl.searchParams.get("filter");

  if (filter === "all") {
    const [settlementRows, allRows] = await Promise.all([
      prisma.medication.groupBy({
        by: ["companyName"],
        where: { isSettlement: true },
        _count: { id: true },
      }),
      prisma.medication.groupBy({
        by: ["companyName"],
        _count: { id: true },
        orderBy: { companyName: "asc" },
      }),
    ]);
    const settlementSet = new Set(settlementRows.map((c) => c.companyName));
    return NextResponse.json(
      allRows.map((c) => ({
        name: c.companyName,
        isSettlement: settlementSet.has(c.companyName),
        count: c._count.id,
      }))
    );
  }

  const companies = await prisma.medication.groupBy({
    by: ["companyName"],
    where: { isSettlement: true },
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
