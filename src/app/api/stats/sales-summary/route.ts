import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

// 거래처×월 기준 제약사별 매출 요약 — 처방통계 등록 페이지에서 거래처 선택 시 표시.
// 당월/전월/전전월 3개월 동시 조회. 거래가능 제약사 (SubmissionRoute) + 실제 매출 발생
// 제약사 모두 포함.
//
// GET /api/stats/sales-summary?clientId=X&year=Y&month=M

interface FinalDrugRecord {
  companyName?: string;
  quantity?: string;
  unitPrice?: number | null;
}

interface OcrDataRecord {
  finalDrugs?: FinalDrugRecord[];
  aiDrugs?: FinalDrugRecord[];
}

function prevMonth(year: number, month: number): { year: number; month: number } {
  if (month <= 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const sp = req.nextUrl.searchParams;
  const clientId = sp.get("clientId");
  const yearParam = sp.get("year");
  const monthParam = sp.get("month");
  if (!clientId || !yearParam || !monthParam) {
    return NextResponse.json({ error: "clientId/year/month 필수" }, { status: 400 });
  }
  const year = Number(yearParam);
  const month = Number(monthParam);

  // 거래처 + 권한 검증
  const client = await prisma.userClient.findUnique({
    where: { id: clientId },
    select: { userId: true, clientName: true },
  });
  if (!client) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (user.role !== "ADMIN" && client.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const prev = prevMonth(year, month);
  const prevPrev = prevMonth(prev.year, prev.month);

  // 3개월치 PrescriptionReport 한 번에 조회
  const reports = await prisma.prescriptionReport.findMany({
    where: {
      clientId,
      ...(user.role !== "ADMIN" ? { userId: user.id } : {}),
      OR: [
        { year, month },
        { year: prev.year, month: prev.month },
        { year: prevPrev.year, month: prevPrev.month },
      ],
    },
    select: { ocrData: true, year: true, month: true, status: true },
  });

  // 거래가능 제약사 목록 (SubmissionRoute active)
  const routes = (await prisma.submissionRoute.findMany({
    where: { clientName: client.clientName, active: true },
    select: { companyName: true },
  })) as Array<{ companyName: string }>;
  const allowedCompanies = new Set<string>(routes.map((r) => r.companyName.trim()));

  // 제약사별 월별 매출 + 사진 수 + 처리 상태
  interface MonthAgg { sales: number; photoCount: number }
  const byCompany = new Map<string, { current: MonthAgg; prev: MonthAgg; prevPrev: MonthAgg }>();
  // 처리 중/실패 카운트 (당월만)
  let currentProcessingCount = 0;
  let currentErrorCount = 0;

  function bucket(name: string) {
    const trimmed = (name || "(미분류)").trim();
    const existing = byCompany.get(trimmed);
    if (existing) return existing;
    const fresh = {
      current: { sales: 0, photoCount: 0 },
      prev: { sales: 0, photoCount: 0 },
      prevPrev: { sales: 0, photoCount: 0 },
    };
    byCompany.set(trimmed, fresh);
    return fresh;
  }

  for (const r of reports) {
    const isCurrent = r.year === year && r.month === month;
    if (isCurrent) {
      if (r.status === "PROCESSING") currentProcessingCount++;
      if (r.status === "ERROR") currentErrorCount++;
    }
    if (r.status === "ERROR") continue;     // 실패는 매출 합계 제외

    const ocr = (r.ocrData ?? {}) as OcrDataRecord;
    const drugs = ocr.finalDrugs ?? ocr.aiDrugs ?? [];
    if (drugs.length === 0) continue;

    // 사진 1장에 들어있는 제약사들 (set) — 사진 수 카운트용
    const photoCompanies = new Set<string>();
    for (const d of drugs) {
      const name = (d.companyName || "(미분류)").trim();
      const qty = parseFloat(d.quantity ?? "") || 0;
      const unit = d.unitPrice ?? 0;
      const sales = qty * unit;
      const agg = bucket(name);
      let target: MonthAgg;
      if (r.year === year && r.month === month) target = agg.current;
      else if (r.year === prev.year && r.month === prev.month) target = agg.prev;
      else target = agg.prevPrev;
      target.sales += sales;
      photoCompanies.add(name);
    }
    for (const name of photoCompanies) {
      const agg = bucket(name);
      if (r.year === year && r.month === month) agg.current.photoCount += 1;
      else if (r.year === prev.year && r.month === prev.month) agg.prev.photoCount += 1;
      else agg.prevPrev.photoCount += 1;
    }
  }

  // 거래가능 제약사도 빈 row 로 포함 (실적 0이라도 표시)
  for (const name of allowedCompanies) {
    bucket(name);
  }

  const list = Array.from(byCompany.entries())
    .map(([name, agg]) => ({
      companyName: name,
      isAllowed: allowedCompanies.has(name),
      currentSales: Math.round(agg.current.sales),
      prevSales: Math.round(agg.prev.sales),
      prevPrevSales: Math.round(agg.prevPrev.sales),
      currentPhotoCount: agg.current.photoCount,
    }))
    // 거래가능 제약사 우선, 그 안에서 당월 매출 큰 순
    .sort((a, b) => {
      if (a.isAllowed !== b.isAllowed) return a.isAllowed ? -1 : 1;
      return b.currentSales - a.currentSales;
    });

  return NextResponse.json({
    clientId,
    year,
    month,
    prevYear: prev.year,
    prevMonth: prev.month,
    prevPrevYear: prevPrev.year,
    prevPrevMonth: prevPrev.month,
    byCompany: list,
    currentProcessingCount,
    currentErrorCount,
  });
}
