import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const companies = await prisma.medication.groupBy({
    by: ["companyName", "isSettlement"],
    _count: { id: true },
    orderBy: [{ isSettlement: "desc" }, { companyName: "asc" }],
  });

  return NextResponse.json(
    companies.map((c) => ({
      name: c.companyName,
      isSettlement: c.isSettlement,
      count: c._count.id,
    }))
  );
}
