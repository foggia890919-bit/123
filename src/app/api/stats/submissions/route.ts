import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

// 거래처×월 단위 제출 상태 + 검수 지표 API.
//
// 1) GET /api/stats/submissions?clientId=X&year=Y&month=M
//    → 특정 거래처×월 상세 (업로드 차단 판단 + 검수 페이지 상세)
//
// 2) GET /api/stats/submissions
//    → 전체 그룹 목록 (관리자 검수 메뉴용)
//
// AI 정확도 지표 — ocrData 에서 추출/계산:
// - rowCount: 모든 사진의 약품 행 합계 (finalDrugs.length 합)
// - photoCount: 사진 수
// - totalFee: 매출 합계
// - avgConfidence: avgConfidence 평균 (ocrData.avgConfidence)
// - masterMatchRate: matchedMedicationId 가 있는 행 비율
// - mismatchCount: mismatch 가 있는 행 수 (보험코드↔이름 불일치)
// - partialExtractionCount: summary.drugCount 와 drugs.length 다른 사진 수

interface FinalDrugRecord {
  insuranceCode?: string;
  matchedMedicationId?: string | null;
  mismatch?: unknown;
}

interface OcrDataRecord {
  finalDrugs?: FinalDrugRecord[];
  aiDrugs?: FinalDrugRecord[];
  avgConfidence?: number;
  geminiMeta?: {
    summary?: { drugCount?: number };
  };
}

interface ReportForMetrics {
  ocrData: unknown;
  totalFee: number | null;
}

interface ReportInGroup {
  ocrData: unknown;
  status: string;
  totalFee: number | null;
  createdAt: Date;
}

function computeMetrics(reports: Array<{ ocrData: unknown; totalFee: number | null; status?: string }>) {
  let rowCount = 0;
  let totalFee = 0;
  let masterMatched = 0;
  let mismatchCount = 0;
  let partialExtractionCount = 0;
  let processingCount = 0;
  let errorCount = 0;
  const confidenceSum: number[] = [];

  for (const r of reports) {
    if (r.status === "PROCESSING") processingCount++;
    if (r.status === "ERROR") errorCount++;

    const ocr = (r.ocrData ?? {}) as OcrDataRecord;
    const drugs = ocr.finalDrugs ?? ocr.aiDrugs ?? [];
    rowCount += drugs.length;
    totalFee += r.totalFee ?? 0;

    for (const d of drugs) {
      if (d.matchedMedicationId) masterMatched++;
      if (d.mismatch != null) mismatchCount++;
    }
    if (typeof ocr.avgConfidence === "number") confidenceSum.push(ocr.avgConfidence);

    const detected = ocr.geminiMeta?.summary?.drugCount ?? 0;
    if (detected > 0 && detected !== drugs.length) {
      partialExtractionCount++;
    }
  }

  return {
    rowCount,
    photoCount: reports.length,
    totalFee: Math.round(totalFee),
    avgConfidence: confidenceSum.length
      ? Math.round(confidenceSum.reduce((s, x) => s + x, 0) / confidenceSum.length)
      : 0,
    masterMatchRate: rowCount > 0 ? Math.round((masterMatched / rowCount) * 100) : 0,
    mismatchCount,
    partialExtractionCount,
    processingCount,
    errorCount,
  };
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const sp = req.nextUrl.searchParams;
  const clientIdParam = sp.get("clientId");
  const yearParam = sp.get("year");
  const monthParam = sp.get("month");

  // 본인 데이터만 (ADMIN/BIZ 는 전체)
  const baseWhere = user.role === "ADMIN" || user.role === "BIZ"
    ? {}
    : { userId: user.id };

  // ── 모드 1: 특정 거래처×월 상세 ──
  if (clientIdParam && yearParam && monthParam) {
    const year = Number(yearParam);
    const month = Number(monthParam);

    const reports = await prisma.prescriptionReport.findMany({
      where: { ...baseWhere, clientId: clientIdParam, year, month },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, userId: true, clientId: true, hospitalName: true, companyName: true,
        ocrData: true, status: true, totalFee: true, createdAt: true, imageKey: true,
        client: { select: { id: true, clientName: true } },
      },
    });

    interface ReportRowDetailed {
      id: string;
      userId: string;
      clientId: string | null;
      hospitalName: string | null;
      companyName: string | null;
      ocrData: unknown;
      status: string;
      totalFee: number | null;
      createdAt: Date;
      imageKey: string | null;
      client: { id: string; clientName: string } | null;
    }
    const typedReports = reports as ReportRowDetailed[];
    const metrics = computeMetrics(typedReports.map((r) => ({ ocrData: r.ocrData, totalFee: r.totalFee, status: r.status })));
    const submitted = typedReports.length > 0 && typedReports.every((r) => r.status === "SUBMITTED");

    return NextResponse.json({
      clientId: clientIdParam,
      clientName: typedReports[0]?.client?.clientName ?? null,
      year,
      month,
      submitted,
      metrics,
      reports: typedReports.map((r) => ({
        id: r.id,
        hospitalName: r.hospitalName,
        companyName: r.companyName,
        status: r.status,
        totalFee: r.totalFee,
        createdAt: r.createdAt,
        hasImage: !!r.imageKey,
        ocrData: r.ocrData,        // 검수 페이지 상세에서 약품 행 표시용
      })),
    });
  }

  // ── 모드 2: 전체 그룹 목록 (검수 메뉴) ──
  const allReports = await prisma.prescriptionReport.findMany({
    where: baseWhere,
    orderBy: { createdAt: "desc" },
    select: {
      clientId: true, year: true, month: true, ocrData: true, status: true,
      totalFee: true, createdAt: true,
      client: { select: { id: true, clientName: true } },
    },
  });

  // 그룹핑: clientId|year|month
  interface GroupAcc {
    clientId: string;
    clientName: string;
    year: number;
    month: number;
    reports: ReportInGroup[];
  }
  const groups = new Map<string, GroupAcc>();

  for (const r of allReports) {
    if (!r.clientId || !r.client) continue;
    const key = `${r.clientId}|${r.year}|${r.month}`;
    const existing: GroupAcc = groups.get(key) ?? {
      clientId: r.clientId,
      clientName: r.client.clientName,
      year: r.year,
      month: r.month,
      reports: [],
    };
    existing.reports.push({
      ocrData: r.ocrData, status: r.status, totalFee: r.totalFee, createdAt: r.createdAt,
    });
    groups.set(key, existing);
  }

  const list = Array.from(groups.values()).map((g) => {
    const metrics = computeMetrics(g.reports);
    const submitted = g.reports.every((r) => r.status === "SUBMITTED");
    const latestAt = g.reports.reduce<Date | null>((a, r) =>
      !a || r.createdAt > a ? r.createdAt : a, null);
    return {
      clientId: g.clientId,
      clientName: g.clientName,
      year: g.year,
      month: g.month,
      submitted,
      latestAt,
      metrics,
    };
  });

  // 최신 정렬
  list.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.month !== b.month) return b.month - a.month;
    return (b.latestAt?.getTime() ?? 0) - (a.latestAt?.getTime() ?? 0);
  });

  return NextResponse.json(list);
}
