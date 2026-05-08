import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { getViewableUserIds } from "@/lib/hierarchy";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const year = parseInt(
    req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  );

  const viewableIds = session.role === "ADMIN"
    ? undefined
    : await getViewableUserIds(session.id);

  const directChildren = session.role === "ADMIN" ? [] : await prisma.user.findMany({
    where: { parentUserId: session.id },
    select: { role: true },
  });
  const isAggregateOnly = directChildren.some((c) => c.role === "BIZ");

  const reports = await prisma.prescriptionReport.findMany({
    where: { userId: viewableIds ? { in: viewableIds } : undefined, year },
    orderBy: [{ month: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, year: true, month: true,
      hospitalName: true, companyName: true,
      totalFee: true, status: true, createdAt: true,
    },
  });

  // 월별 정산 집계
  const byMonth: Record<number, { confirmed: number; pending: number; confirmedFee: number; pendingFee: number }> = {};
  for (const r of reports) {
    if (!byMonth[r.month]) byMonth[r.month] = { confirmed: 0, pending: 0, confirmedFee: 0, pendingFee: 0 };
    const fee = r.totalFee ?? 0;
    if (fee > 0) {
      byMonth[r.month].confirmed++;
      byMonth[r.month].confirmedFee += fee;
    } else {
      byMonth[r.month].pending++;
      byMonth[r.month].pendingFee += fee;
    }
  }

  const monthly = Array.from({ length: 12 }, (_, i) => {
    const m = byMonth[i + 1];
    return {
      month: i + 1,
      confirmed: m?.confirmed ?? 0,
      pending: m?.pending ?? 0,
      confirmedFee: m?.confirmedFee ?? 0,
    };
  });

  const totals = {
    totalFee: reports.reduce((s, r) => s + (r.totalFee ?? 0), 0),
    confirmedCount: reports.filter((r) => (r.totalFee ?? 0) > 0).length,
    pendingCount: reports.filter((r) => !(r.totalFee ?? 0)).length,
    totalCount: reports.length,
  };

  // 개별 보고서 목록 (최근 50건)
  const items = reports.slice(0, 50).map((r) => ({
    id: r.id,
    year: r.year,
    month: r.month,
    hospitalName: r.hospitalName,
    companyName: r.companyName,
    totalFee: r.totalFee,
    status: r.totalFee != null && r.totalFee > 0 ? "CONFIRMED" : "PENDING",
    createdAt: r.createdAt,
  }));

  const allYears = await prisma.prescriptionReport.findMany({
    where: { userId: viewableIds ? { in: viewableIds } : undefined },
    select: { year: true },
    distinct: ["year"],
    orderBy: { year: "desc" },
  });

  return NextResponse.json({
    year, monthly, totals,
    items: isAggregateOnly ? [] : items,
    availableYears: allYears.map((r) => r.year),
    isAggregateOnly,
  });
}
