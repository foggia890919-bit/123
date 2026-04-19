import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
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
