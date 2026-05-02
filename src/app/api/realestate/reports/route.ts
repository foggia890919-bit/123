import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runDailyReport } from "@/realestate/report/daily";

export const dynamic = "force-dynamic";

export async function GET() {
  const reports = await prisma.dailyReport.findMany({
    orderBy: { reportDate: "desc" },
    take: 30,
  });
  return NextResponse.json({ reports });
}

export async function POST() {
  const r = await runDailyReport();
  return NextResponse.json(r);
}
