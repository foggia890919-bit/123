import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const year = parseInt(
    req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  );

  const reports = await prisma.prescriptionReport.findMany({
    where: { userId: session.id, year },
    orderBy: [{ month: "asc" }, { createdAt: "desc" }],
    select: {
      id: true, year: true, month: true,
      hospitalName: true, companyName: true,
      totalFee: true, status: true, createdAt: true,
    },
  });

  // 월별 집계
  const byMonth: Record<number, { count: number; hospitals: Set<string>; companies: Set<string>; totalFee: number }> = {};
  for (const r of reports) {
    if (!byMonth[r.month]) byMonth[r.month] = { count: 0, hospitals: new Set(), companies: new Set(), totalFee: 0 };
    byMonth[r.month].count++;
    byMonth[r.month].totalFee += r.totalFee ?? 0;
    if (r.hospitalName) byMonth[r.month].hospitals.add(r.hospitalName);
    if (r.companyName) byMonth[r.month].companies.add(r.companyName);
  }

  const monthly = Array.from({ length: 12 }, (_, i) => {
    const m = byMonth[i + 1];
    return {
      month: i + 1,
      count: m?.count ?? 0,
      hospitalCount: m?.hospitals.size ?? 0,
      companyCount: m?.companies.size ?? 0,
      totalFee: m?.totalFee ?? 0,
    };
  });

  // 제약사별 집계
  const companyMap: Record<string, { count: number; totalFee: number }> = {};
  for (const r of reports) {
    const k = r.companyName || "기타";
    if (!companyMap[k]) companyMap[k] = { count: 0, totalFee: 0 };
    companyMap[k].count++;
    companyMap[k].totalFee += r.totalFee ?? 0;
  }
  const byCompany = Object.entries(companyMap)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.totalFee - a.totalFee)
    .slice(0, 10);

  const totals = {
    count: reports.length,
    hospitalCount: new Set(reports.map((r) => r.hospitalName).filter(Boolean)).size,
    companyCount: new Set(reports.map((r) => r.companyName).filter(Boolean)).size,
    totalFee: reports.reduce((s, r) => s + (r.totalFee ?? 0), 0),
  };

  // 사용 가능한 연도 목록
  const allYears = await prisma.prescriptionReport.findMany({
    where: { userId: session.id },
    select: { year: true },
    distinct: ["year"],
    orderBy: { year: "desc" },
  });

  return NextResponse.json({ year, monthly, totals, byCompany, availableYears: allYears.map((r) => r.year) });
}
