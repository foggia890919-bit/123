import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { companyNameKey, normalizeCompanyName } from "@/lib/company-name";

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
    select: { ocrData: true, year: true, month: true, status: true, companyName: true },
  });

  // 거래가능 제약사 목록 (SubmissionRoute active)
  const routes = (await prisma.submissionRoute.findMany({
    where: { clientName: client.clientName, active: true },
    select: { companyName: true },
  })) as Array<{ companyName: string }>;
  // 거래가능 제약사 — fingerprint key 로 비교용 set + 원본 표기 보존 map.
  // "(주)셀트리온제약" 과 "셀트리온제약" 같은 key 로 잡힘.
  const allowedKeySet = new Set<string>();
  const allowedNameByKey = new Map<string, string>();
  for (const r of routes) {
    const key = companyNameKey(r.companyName);
    if (!key) continue;
    allowedKeySet.add(key);
    if (!allowedNameByKey.has(key)) allowedNameByKey.set(key, r.companyName.trim());
  }

  // 제약사별 월별 매출 + 수량 + 사진 수 + 처리 상태.
  // key = companyNameKey (정규화) — "(주)셀트리온", "셀트리온제약(본사)" 같은 key 로 합산.
  // displayName = 가장 정식 표기 (allowed 우선 → 가장 긴 원본 → normalize 결과).
  // sales / quantity 둘 다 합산 — 비급여 약품은 단가 0 이라 매출만으론 부족, 수량이 진짜 지표.
  interface MonthAgg { sales: number; quantity: number; photoCount: number }
  interface CompanyBucket { displayName: string; current: MonthAgg; prev: MonthAgg; prevPrev: MonthAgg }
  const byCompany = new Map<string, CompanyBucket>();
  let currentProcessingCount = 0;
  let currentErrorCount = 0;

  function bucket(rawName: string): CompanyBucket {
    const raw = (rawName || "").trim();
    const key = companyNameKey(raw) || "__unmatched__";
    const existing = byCompany.get(key);
    if (existing) {
      const allowed = allowedNameByKey.get(key);
      if (allowed) existing.displayName = allowed;
      else if (raw && raw.length > existing.displayName.length) existing.displayName = raw;
      return existing;
    }
    const fresh: CompanyBucket = {
      displayName: allowedNameByKey.get(key) || normalizeCompanyName(raw) || raw || "(미분류)",
      current: { sales: 0, quantity: 0, photoCount: 0 },
      prev: { sales: 0, quantity: 0, photoCount: 0 },
      prevPrev: { sales: 0, quantity: 0, photoCount: 0 },
    };
    byCompany.set(key, fresh);
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

    // 사진 1장에 들어있는 제약사들 (정규화 키 set) — 사진 수 카운트용 (한 사진이 한 회사 두번 X)
    const photoKeys = new Set<string>();
    for (const d of drugs) {
      const rowCompany = (d.companyName || "").trim();
      const reportCompany = (r.companyName || "").trim();
      const name = rowCompany || reportCompany || "(미분류)";
      const qty = parseFloat(d.quantity ?? "") || 0;
      const unit = d.unitPrice ?? 0;
      const sales = qty * unit;
      const agg = bucket(name);
      let target: MonthAgg;
      if (r.year === year && r.month === month) target = agg.current;
      else if (r.year === prev.year && r.month === prev.month) target = agg.prev;
      else target = agg.prevPrev;
      target.sales += sales;
      target.quantity += qty;
      photoKeys.add(companyNameKey(name) || "__unmatched__");
    }
    for (const key of photoKeys) {
      const agg = byCompany.get(key);
      if (!agg) continue;
      if (r.year === year && r.month === month) agg.current.photoCount += 1;
      else if (r.year === prev.year && r.month === prev.month) agg.prev.photoCount += 1;
      else agg.prevPrev.photoCount += 1;
    }
  }

  // 거래가능 제약사도 빈 row 로 포함 (실적 0이라도 표시)
  for (const r of routes) {
    bucket(r.companyName);
  }

  const list = Array.from(byCompany.entries())
    .map(([key, agg]) => ({
      companyName: agg.displayName,
      isAllowed: allowedKeySet.has(key),
      currentSales: Math.round(agg.current.sales),
      currentQuantity: Math.round(agg.current.quantity * 10) / 10,
      prevSales: Math.round(agg.prev.sales),
      prevQuantity: Math.round(agg.prev.quantity * 10) / 10,
      prevPrevSales: Math.round(agg.prevPrev.sales),
      prevPrevQuantity: Math.round(agg.prevPrev.quantity * 10) / 10,
      currentPhotoCount: agg.current.photoCount,
    }))
    // 거래 외 + 매출 + 수량 모두 0 = 노이즈. 거래가능은 0 이라도 표시.
    .filter((c) =>
      c.isAllowed
      || c.currentSales > 0 || c.prevSales > 0 || c.prevPrevSales > 0
      || c.currentQuantity > 0 || c.prevQuantity > 0 || c.prevPrevQuantity > 0,
    )
    // 거래가능 제약사 우선, 그 안에서 당월 매출 큰 순 (매출 0 이면 수량 큰 순)
    .sort((a, b) => {
      if (a.isAllowed !== b.isAllowed) return a.isAllowed ? -1 : 1;
      if (b.currentSales !== a.currentSales) return b.currentSales - a.currentSales;
      return b.currentQuantity - a.currentQuantity;
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
