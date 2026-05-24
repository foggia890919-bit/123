import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { getViewableUserIds } from "@/lib/hierarchy";

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
  productName?: string;
  companyName?: string;
  quantity?: string;
  matchedMedicationId?: string | null;
  mismatch?: unknown;
  companyNameMismatch?: unknown;
  finalConfidence?: number;
  // OCR 원본 약가 + 자동 교체 여부 — 검수 UI 단가 셀 dot 표시용
  originalUnitPrice?: number | null;
  priceAutoReplaced?: boolean;
  // Gemini 자가검증 결과 ("selfValidateMismatch" | "nameCodeMismatch" | null).
  // 검수자가 셀 편집 후 저장하면 finalDrugs 재구성으로 자동 클리어됨.
  reviewReason?: string | null;
  qualityChecks?: {
    priceMatch?: { applicable?: boolean; matched?: boolean };
    revenueMatch?: { applicable?: boolean; matched?: boolean };
    prefixMatch?: { applicable?: boolean; matched?: boolean };
  };
}

// 사진별 약품 fingerprint — (보험코드 또는 제품명) + 수량 set.
// Jaccard 유사도로 두 사진의 약품 겹침 비율 계산 → 70%+ 면 중복 의심.
// SHA-256 사진 hash 는 다르지만 다른 각도로 찍은 같은 사진 또는 옛 데이터 중복 검출.
function fingerprintDrugs(drugs: FinalDrugRecord[]): Set<string> {
  const set = new Set<string>();
  for (const d of drugs) {
    const code = (d.insuranceCode || "").replace(/\D/g, "");
    const nameKey = (d.productName || "").trim().replace(/\s+/g, "").toLowerCase();
    const key = code.length === 9 ? code : nameKey;
    if (!key) continue;
    const qty = String(d.quantity || "").replace(/\s+/g, "");
    set.add(`${key}|${qty}`);
  }
  return set;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  return intersection / Math.min(a.size, b.size);
}

interface OcrDataRecord {
  finalDrugs?: FinalDrugRecord[];
  aiDrugs?: FinalDrugRecord[];
  avgConfidence?: number;
  totalSumCheck?: { applicable?: boolean; matched?: boolean };
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
  // 검증 강화로 추가된 행 단위 지표 — 검수자가 어떤 사진을 우선 봐야 할지 판단용.
  let lowQualityRowCount = 0;        // finalConfidence < 75
  let priceMismatchCount = 0;        // priceCheck applicable && !matched
  let revenueMismatchCount = 0;      // revenueCheck applicable && !matched
  let companyMismatchCount = 0;      // Gemini companyName vs 마스터 companyName 불일치
  let totalSumMismatchCount = 0;     // 사진 단위 합계 불일치 (사진 수)
  let selfValidateMismatchCount = 0; // Gemini 텍스트 자가검증으로 잡힌 행 수
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
      if (d.companyNameMismatch != null) companyMismatchCount++;
      if (typeof d.finalConfidence === "number" && d.finalConfidence < 75) lowQualityRowCount++;
      if (d.reviewReason === "selfValidateMismatch") selfValidateMismatchCount++;
      const pq = d.qualityChecks?.priceMatch;
      if (pq?.applicable && pq?.matched === false) priceMismatchCount++;
      const rq = d.qualityChecks?.revenueMatch;
      if (rq?.applicable && rq?.matched === false) revenueMismatchCount++;
    }
    if (typeof ocr.avgConfidence === "number") confidenceSum.push(ocr.avgConfidence);

    if (ocr.totalSumCheck?.applicable && ocr.totalSumCheck?.matched === false) {
      totalSumMismatchCount++;
    }

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
    lowQualityRowCount,
    priceMismatchCount,
    revenueMismatchCount,
    companyMismatchCount,
    totalSumMismatchCount,
    selfValidateMismatchCount,
  };
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const sp = req.nextUrl.searchParams;
  const clientIdParam = sp.get("clientId");
  const yearParam = sp.get("year");
  const monthParam = sp.get("month");

  // 상위법인 자동 라우팅 — ADMIN/BIZ 는 전체. 그 외는:
  //   본인 ownerId
  //   + 본인 parentUserId hierarchy (User.parentUserId 기반)
  //   + 본인이 SubmissionRoute.parentUserId 인 매핑들의 ownerId (사용자 의도)
  // SubmissionRoute.parentUserId 가 핵심 — 거래처관리에서 상위법인으로 본인을 매핑한
  // 회원들의 통계도 본인이 봄 (단일 hierarchy 아닌 다대다 매핑).
  let viewableIds: string[] | null = null;
  if (user.role !== "ADMIN" && user.role !== "BIZ") {
    const [hierarchyIds, routesAsParent] = await Promise.all([
      getViewableUserIds(user.id),
      prisma.submissionRoute.findMany({
        where: { parentUserId: user.id, active: true },
        select: { ownerId: true },
        distinct: ["ownerId"],
      }),
    ]);
    viewableIds = Array.from(new Set([...hierarchyIds, ...routesAsParent.map((r) => r.ownerId)]));
  }
  const baseWhere = viewableIds === null
    ? {}
    : { userId: { in: viewableIds } };

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

    // 중복 의심 분석 — 같은 그룹 안에서 사진 짝지어 약품 fingerprint 비교
    const reportFingerprints = typedReports.map((r) => {
      const ocr = (r.ocrData ?? {}) as OcrDataRecord;
      const drugs = ocr.finalDrugs ?? ocr.aiDrugs ?? [];
      return { id: r.id, fp: fingerprintDrugs(drugs) };
    });
    interface DupSimilar { reportId: string; similarity: number }
    const duplicateBy: Record<string, DupSimilar[]> = {};
    for (let i = 0; i < reportFingerprints.length; i++) {
      const matches: DupSimilar[] = [];
      for (let j = 0; j < reportFingerprints.length; j++) {
        if (i === j) continue;
        const sim = jaccardSimilarity(reportFingerprints[i].fp, reportFingerprints[j].fp);
        if (sim >= 0.7) {
          matches.push({ reportId: reportFingerprints[j].id, similarity: Math.round(sim * 100) });
        }
      }
      if (matches.length > 0) {
        // 유사도 높은 순
        matches.sort((a, b) => b.similarity - a.similarity);
        duplicateBy[reportFingerprints[i].id] = matches;
      }
    }
    const duplicateCount = Object.keys(duplicateBy).length;

    return NextResponse.json({
      clientId: clientIdParam,
      clientName: typedReports[0]?.client?.clientName ?? null,
      year,
      month,
      submitted,
      metrics,
      duplicateCount,
      duplicateBy,
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
      totalFee: true, createdAt: true, userId: true,
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
    uploaderIds: Set<string>;
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
      uploaderIds: new Set<string>(),
    };
    existing.reports.push({
      ocrData: r.ocrData, status: r.status, totalFee: r.totalFee, createdAt: r.createdAt,
    });
    if (r.userId) existing.uploaderIds.add(r.userId);
    groups.set(key, existing);
  }

  // 그룹 전반에서 등장한 모든 업로더 user id → name/email 한 번에 lookup.
  const allUploaderIds = Array.from(new Set(
    Array.from(groups.values()).flatMap((g) => Array.from(g.uploaderIds)),
  ));
  type UploaderUser = { id: string; name: string | null; email: string };
  const uploaderUsers: UploaderUser[] = allUploaderIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: allUploaderIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const uploaderById = new Map(uploaderUsers.map((u) => [u.id, u] as const));

  const list = Array.from(groups.values()).map((g) => {
    const metrics = computeMetrics(g.reports);
    const submitted = g.reports.every((r) => r.status === "SUBMITTED");
    const latestAt = g.reports.reduce<Date | null>((a, r) =>
      !a || r.createdAt > a ? r.createdAt : a, null);
    // 업로더 목록 — 그룹 카드에 노출. 한 그룹에 여러 영업사원이 사진 올렸을 수 있음.
    const uploaders = Array.from(g.uploaderIds)
      .map((id) => uploaderById.get(id))
      .filter((u): u is { id: string; name: string | null; email: string } => !!u)
      .map((u) => ({ name: u.name, email: u.email }))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    return {
      clientId: g.clientId,
      clientName: g.clientName,
      year: g.year,
      month: g.month,
      submitted,
      latestAt,
      metrics,
      uploaders,
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
