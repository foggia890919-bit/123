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

  // 당월 거래처 × 제약사(거래가능코드) 제출현황
  // ADMIN / 상위법인은 거래처가 너무 많아 생략
  const curMonthRows: { hospitalName: string; companyName: string; totalFee: number; submitted: boolean; confirmed: boolean }[] = [];
  if (!isUpperCorp && session.role !== "ADMIN" && viewableIds) {
    // 1. 등록 거래처 전체
    const userClients = await prisma.userClient.findMany({
      where: { userId: { in: viewableIds }, approved: true },
      select: { id: true, clientName: true, bizNumber: true },
    });

    // 2. 거래가능코드(APPROVED 필터) 가져오기
    const approvedFilters = await prisma.filterRequest.findMany({
      where: {
        userId: { in: viewableIds },
        status: "APPROVED",
        bizNumber: { in: userClients.map((c) => c.bizNumber) },
      },
      select: { bizNumber: true, clientName: true, companyName: true },
    });

    // 3. 당월 제출된 보고서 (clientId 기준)
    const curMonthReports = await prisma.prescriptionReport.findMany({
      where: { userId: { in: viewableIds }, year, month: curMonth },
      select: { clientId: true, totalFee: true },
    });
    const submittedSet = new Set(curMonthReports.filter((r) => r.clientId).map((r) => r.clientId!));
    const feeByClient = new Map<string, number>();
    for (const r of curMonthReports) {
      if (r.clientId) feeByClient.set(r.clientId, (feeByClient.get(r.clientId) ?? 0) + (r.totalFee ?? 0));
    }

    const clientByBiz = new Map(userClients.map((c) => [c.bizNumber, c]));

    // 거래처별로 승인된 제약사 조합 생성, 중복 제거
    const seen = new Set<string>();
    for (const f of approvedFilters) {
      const client = clientByBiz.get(f.bizNumber);
      const hospitalName = client?.clientName ?? f.clientName;
      const key = `${hospitalName}|||${f.companyName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const submitted = client ? submittedSet.has(client.id) : false;
      const totalFee = client ? (feeByClient.get(client.id) ?? 0) : 0;
      curMonthRows.push({ hospitalName, companyName: f.companyName, totalFee, submitted, confirmed: totalFee > 0 });
    }

    // 거래가능코드 없는 거래처도 행 추가 (제약사 없이)
    const coveredBizNums = new Set(approvedFilters.map((f) => f.bizNumber));
    for (const c of userClients) {
      if (!coveredBizNums.has(c.bizNumber)) {
        const submitted = submittedSet.has(c.id);
        const totalFee = feeByClient.get(c.id) ?? 0;
        curMonthRows.push({ hospitalName: c.clientName, companyName: "-", totalFee, submitted, confirmed: totalFee > 0 });
      }
    }

    curMonthRows.sort((a, b) => a.hospitalName.localeCompare(b.hospitalName) || a.companyName.localeCompare(b.companyName));
  }

  return NextResponse.json({ year, monthly, totals, byCompany, comparison, availableYears: allYears.map((r) => r.year), isUpperCorp, curMonth, curMonthRows });
}
