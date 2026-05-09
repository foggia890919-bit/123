import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { getViewableUserIds } from "@/lib/hierarchy";

interface FinalDrug {
  companyName?: string;
  productName?: string;
  quantity?: string;
  unitPrice?: number | null;
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const year = parseInt(
    req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  );

  const viewableIds = session.role === "ADMIN"
    ? undefined
    : await getViewableUserIds(session.id);

  // 직속 하위에 BIZ가 있으면 상위법인
  const isUpperCorp = session.role !== "ADMIN" && (
    await prisma.user.count({ where: { parentUserId: session.id, role: "BIZ" } })
  ) > 0;

  const reports = await prisma.prescriptionReport.findMany({
    where: { userId: viewableIds ? { in: viewableIds } : undefined, year },
    orderBy: [{ month: "asc" }, { createdAt: "desc" }],
    select: {
      id: true, year: true, month: true,
      hospitalName: true, companyName: true,
      totalFee: true, status: true, createdAt: true,
      ocrData: true,
    },
  });

  const now = new Date();
  const curMonth = now.getFullYear() === year ? now.getMonth() + 1 : 12;
  const prevMonth = curMonth === 1 ? null : curMonth - 1;

  const byMonth: Record<number, { count: number; hospitals: Set<string>; companies: Set<string>; totalFee: number; prescriptionTotal: number }> = {};
  let prescriptionTotal = 0;

  for (const r of reports) {
    if (!byMonth[r.month]) byMonth[r.month] = { count: 0, hospitals: new Set(), companies: new Set(), totalFee: 0, prescriptionTotal: 0 };
    byMonth[r.month].count++;
    byMonth[r.month].totalFee += r.totalFee ?? 0;
    if (r.hospitalName) byMonth[r.month].hospitals.add(r.hospitalName);
    if (r.companyName) byMonth[r.month].companies.add(r.companyName);

    try {
      const ocd = r.ocrData as Record<string, unknown> | null;
      const drugs: FinalDrug[] = (ocd?.finalDrugs ?? ocd?.aiDrugs ?? []) as FinalDrug[];
      for (const d of drugs) {
        const qty = parseFloat(d.quantity ?? "0") || 0;
        const price = d.unitPrice ?? 0;
        const rx = qty * price;
        byMonth[r.month].prescriptionTotal += rx;
        prescriptionTotal += rx;
      }
    } catch { /* skip */ }
  }

  const monthly = Array.from({ length: 12 }, (_, i) => {
    const m = byMonth[i + 1];
    return {
      month: i + 1,
      count: m?.count ?? 0,
      hospitalCount: m?.hospitals.size ?? 0,
      companyCount: m?.companies.size ?? 0,
      totalFee: m?.totalFee ?? 0,
      prescriptionTotal: m?.prescriptionTotal ?? 0,
    };
  });

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

  const totalFee = reports.reduce((s, r) => s + (r.totalFee ?? 0), 0);
  const totals = {
    count: reports.length,
    hospitalCount: new Set(reports.map((r) => r.hospitalName).filter(Boolean)).size,
    companyCount: new Set(reports.map((r) => r.companyName).filter(Boolean)).size,
    totalFee,
    prescriptionTotal,
  };

  const cur = byMonth[curMonth];
  const prev = prevMonth ? byMonth[prevMonth] : null;
  const comparison = {
    curMonth, prevMonth,
    curHospitals: cur?.hospitals.size ?? 0,
    prevHospitals: prev?.hospitals.size ?? 0,
    curCount: cur?.count ?? 0,
    prevCount: prev?.count ?? 0,
    curFee: cur?.totalFee ?? 0,
    prevFee: prev?.totalFee ?? 0,
  };

  const allYears = await prisma.prescriptionReport.findMany({
    where: { userId: viewableIds ? { in: viewableIds } : undefined },
    select: { year: true },
    distinct: ["year"],
    orderBy: { year: "desc" },
  });

  // 당월 거래처별 제약사 제출현황
  const curMonthRows: { hospitalName: string; companyName: string; totalFee: number; confirmed: boolean }[] = [];
  for (const r of reports.filter((r) => r.month === curMonth)) {
    const hospital = r.hospitalName || "미입력";
    try {
      const ocd = r.ocrData as Record<string, unknown> | null;
      const drugs: FinalDrug[] = (ocd?.finalDrugs ?? ocd?.aiDrugs ?? []) as FinalDrug[];
      const companies = [...new Set(drugs.map((d) => d.companyName?.trim()).filter(Boolean) as string[])];
      if (companies.length > 0) {
        for (const company of companies) {
          curMonthRows.push({ hospitalName: hospital, companyName: company, totalFee: r.totalFee ?? 0, confirmed: (r.totalFee ?? 0) > 0 });
        }
      } else {
        curMonthRows.push({ hospitalName: hospital, companyName: "-", totalFee: r.totalFee ?? 0, confirmed: (r.totalFee ?? 0) > 0 });
      }
    } catch {
      curMonthRows.push({ hospitalName: hospital, companyName: "-", totalFee: r.totalFee ?? 0, confirmed: (r.totalFee ?? 0) > 0 });
    }
  }
  curMonthRows.sort((a, b) => a.hospitalName.localeCompare(b.hospitalName) || a.companyName.localeCompare(b.companyName));

  return NextResponse.json({ year, monthly, totals, byCompany, comparison, availableYears: allYears.map((r) => r.year), isUpperCorp, curMonth, curMonthRows });
}
