import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";
import { appendRxStats } from "@/lib/google-sheets-rx-append";
import type { RxExtractResult, RxDrugRow } from "@/lib/gemini-rx-stats-extract";

// /stats/photo 페이지의 "최종 승인" → DB + 구글 시트 동시 저장.
// DB: 기존 /api/stats POST 와 동일 패턴 (영업실적 / 마이페이지 / 정산 모두 호환).
// 시트: appendRxStats — 원본 효능/카테고리 데이터 풀 보존.
//
// 검수에서 행 추가/삭제/편집된 경우, rawDrugs 와 rows 인덱스 매칭으로 카테고리/효능 보존.

export const runtime = "nodejs";
export const maxDuration = 60;

interface PhotoRow {
  insuranceCode: string;
  companyName: string;
  productName: string;
  quantity: string;
  unitPrice: number;
  totalPrice: number;       // 매출금액 (qty × unit 자동 또는 사용자 수동)
}

interface RequestBody {
  clientId: string | null;
  year: number;
  month: number;
  hospitalName: string;
  companyName: string;             // 전체 제약사명 (대표) — geminiMeta.pharma fallback
  imageBase64: string;             // data URI
  rows: PhotoRow[];
  rawDrugs: RxDrugRow[];           // Gemini 원본 — 행 매칭으로 카테고리/효능 보존
  geminiMeta: {
    pharma: string;
    period: string;
    periodRaw: string;
    summary: RxExtractResult["summary"];
    durationMs: number;
    model: string;
  };
  rawGeminiText: string;
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const { clientId, year, month, hospitalName, companyName, imageBase64, rows, rawDrugs, geminiMeta, rawGeminiText } = body;
  if (!year || !month) return NextResponse.json({ error: "year/month 필수" }, { status: 400 });
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "약품 행이 비어있습니다" }, { status: 400 });
  }

  // 거래처 접근 권한 검증
  let clientApprovedAtSave = false;
  if (clientId) {
    const client = await prisma.userClient.findUnique({
      where: { id: clientId },
      select: { approved: true, userId: true },
    });
    if (client && user.role !== "ADMIN" && client.userId !== user.id) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    clientApprovedAtSave = client?.approved ?? false;
  }

  // 매출금액 합계 = 영업실적 DB 의 totalFee 컬럼
  const totalFee = rows.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0);

  // ── 1) DB 저장 ──────────────────────────────────────────────────────────
  // 기존 영업실적 관리/정산/submission-package 가 ocrData.finalDrugs[] 를 읽어 처방총액 계산.
  // 5컬럼 그대로 + commissionRate/additionalRate/matchedMedicationId 는 null (새 페이지는 미사용).
  const finalDrugs = rows.map((r) => ({
    insuranceCode: r.insuranceCode,
    companyName: r.companyName,
    productName: r.productName,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    commissionRate: null,
    additionalRate: null,
    matchedMedicationId: null,
    bboxYPercent: null,
  }));

  let imageKey: string | null = null;
  let imageDataFallback: string | null = null;
  try {
    const persisted = await persistDataUri(BUCKETS.prescriptionImage, user.id, imageBase64);
    imageKey = persisted.fileKey;
    imageDataFallback = persisted.fileData;
  } catch (e) {
    return NextResponse.json({ error: `이미지 저장 실패: ${String(e).slice(0, 200)}` }, { status: 500 });
  }

  let report;
  try {
    report = await prisma.prescriptionReport.create({
      data: {
        userId: user.id,
        clientId: clientId || null,
        year,
        month,
        hospitalName,
        companyName,
        imageData: imageDataFallback,
        imageKey,
        ocrData: {
          source: "gemini-direct-photo",
          vendor: "unknown",
          captureType: "photo",
          finalDrugs,
          aiDrugs: finalDrugs,
          avgConfidence: 95,
          manualCheckCount: 0,
          rawGeminiText,
          geminiMeta,
          // 시트 append 결과 — 아래에서 patch
          sheetBatchId: null as string | null,
          sheetUrl: null as string | null,
        },
        totalFee,
        clientApprovedAtSave,
        updatedAt: new Date(),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `DB 저장 실패: ${String(e).slice(0, 200)}` }, { status: 500 });
  }

  // ── 2) 구글 시트 append ─────────────────────────────────────────────────
  // 검수에서 행 편집됐을 가능성 — rawDrugs 와 rows 의 insuranceCode + productName 매칭으로
  // 카테고리/효능/처방횟수 보존. 못 찾는 행 (신규 추가) 은 빈 값.
  const rawByKey = new Map(
    rawDrugs.map((d) => [
      `${d.code.replace(/\D/g, "")}|${d.name.replace(/\s+/g, "")}`.toLowerCase(),
      d,
    ]),
  );

  const sheetPayload: RxExtractResult = {
    pharma: companyName || geminiMeta.pharma,
    period: geminiMeta.period,
    periodRaw: geminiMeta.periodRaw,
    hospital: hospitalName,
    summary: {
      drugCount: rows.length,
      totalPrescriptions: geminiMeta.summary.totalPrescriptions,
      totalQuantity: rows.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0),
      totalAmountWon: totalFee,
    },
    drugs: rows.map((r) => {
      const key = `${r.insuranceCode.replace(/\D/g, "")}|${r.productName.replace(/\s+/g, "")}`.toLowerCase();
      const orig = rawByKey.get(key);
      return {
        name: r.productName,
        code: r.insuranceCode,
        // 행별 제약사 — 사용자가 검수에서 수정한 값 우선, 없으면 Gemini 원본
        companyName: r.companyName || orig?.companyName || "",
        quantity: parseFloat(r.quantity) || 0,
        prescriptions: orig?.prescriptions ?? 0,
        unitPrice: r.unitPrice,
        totalPrice: r.totalPrice,
        category: orig?.category ?? "",
        efficacy: orig?.efficacy ?? "",
        bbox: orig?.bbox ?? ([0, 0, 0, 0] as [number, number, number, number]),
      };
    }),
  };

  let sheetUrl: string | null = null;
  let sheetBatchId: string | null = null;
  let sheetWarning: string | null = null;
  try {
    const r = await appendRxStats(sheetPayload, "manual");
    sheetUrl = r.spreadsheetUrl;
    sheetBatchId = r.batchId;
    // DB ocrData 에 시트 결과 patch — 추후 재조회/재시도 식별용
    await prisma.prescriptionReport.update({
      where: { id: report.id },
      data: {
        ocrData: {
          ...(report.ocrData as Record<string, unknown>),
          sheetBatchId,
          sheetUrl,
        },
      },
    });
  } catch (e) {
    sheetWarning = `시트 저장 실패: ${String(e).slice(0, 200)}`;
  }

  return NextResponse.json({
    dbRecordId: report.id,
    sheetUrl,
    sheetBatchId,
    sheetWarning,
    totalFee,
    rowCount: rows.length,
  });
}
