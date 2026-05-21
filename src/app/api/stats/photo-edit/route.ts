import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { replaceRxStats } from "@/lib/google-sheets-rx-append";
import type { RxExtractResult } from "@/lib/gemini-rx-stats-extract";
import { computeRowQuality, checkTotalSum } from "@/lib/rx-quality-checks";

// 검수 페이지에서 수정 후 저장 — DB + 구글 시트 동시 갱신.
// 시트는 옛 batchId 행 삭제 후 새 batchId 로 재append (옛 데이터 안 보이게).

export const runtime = "nodejs";
export const maxDuration = 60;

interface EditRow {
  insuranceCode: string;
  companyName: string;
  productName: string;
  quantity: string;
  unitPrice: number;
  totalPrice: number;     // 매출금액
}

interface RequestBody {
  reportId: string;
  rows: EditRow[];
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

  const { reportId, rows } = body;
  if (!reportId) return NextResponse.json({ error: "reportId 필수" }, { status: 400 });
  if (!Array.isArray(rows)) return NextResponse.json({ error: "rows 필수" }, { status: 400 });

  // 1) 기존 row 조회 + 권한 검증
  const existing = await prisma.prescriptionReport.findUnique({
    where: { id: reportId },
    select: {
      id: true, userId: true, clientId: true, year: true, month: true,
      hospitalName: true, companyName: true, status: true, ocrData: true,
    },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (user.role !== "ADMIN" && existing.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (existing.status === "SUBMITTED" && user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "제출완료된 행은 관리자만 수정 가능합니다" },
      { status: 409 },
    );
  }

  // 2) DB 의 ocrData 갱신 — 수정된 데이터로 행별 quality 재계산.
  // 검수자가 단가 채워주거나 행 추가했으면 그에 맞춰 점수도 갱신.
  // 마스터 매칭은 다시 안 함 (검수자가 이미 봤다는 전제) — codeOk=false, nameSimilar=false 로 보존성 유지.
  const finalDrugs = rows.map((r) => {
    const qtyNum = parseFloat(r.quantity) || 0;
    const { checks, score } = computeRowQuality({
      matchedMedicationId: null,
      codeOk: false,
      nameSimilar: false,
      masterProductName: "",
      ocrProductName: r.productName,
      quantity: qtyNum,
      geminiUnitPrice: undefined,
      masterUnitPrice: null,
      geminiTotalPrice: r.totalPrice || undefined,
      finalUnitPrice: r.unitPrice || null,
    });
    return {
      insuranceCode: r.insuranceCode,
      companyName: r.companyName,
      productName: r.productName,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      commissionRate: null,
      additionalRate: null,
      matchedMedicationId: null,
      bboxYPercent: null,
      finalConfidence: score.overall,
      qualityChecks: checks,
    };
  });
  const totalFee = rows.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0);
  const avgConfidence = finalDrugs.length
    ? Math.round(finalDrugs.reduce((s, d) => s + d.finalConfidence, 0) / finalDrugs.length)
    : 0;
  const manualCheckCount = finalDrugs.filter((d) => d.finalConfidence < 90).length;

  // 한 사진 안의 모든 제약사 (검수 후 행별 companyName set)
  const companySet = new Set<string>();
  for (const fd of finalDrugs) {
    const v = fd.companyName.trim();
    if (v) companySet.add(v);
  }
  const companiesInPhoto = Array.from(companySet);

  // 사진 단위 합계 검증 (검수 후 — 행 매출 합계 = totalFee 자동 일치 가능성 큼)
  const rowSumEdited = rows.reduce((s, r) => s + (r.totalPrice || 0), 0);
  const totalSumCheck = checkTotalSum(rowSumEdited, Math.round(totalFee));

  // 대표 제약사 — 행이 가장 많은 제약사
  const companyRowCount = new Map<string, number>();
  for (const fd of finalDrugs) {
    const k = fd.companyName.trim();
    if (!k) continue;
    companyRowCount.set(k, (companyRowCount.get(k) ?? 0) + 1);
  }
  const dominantCompany = Array.from(companyRowCount.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? existing.companyName ?? "";

  const prevOcr = (existing.ocrData ?? {}) as Record<string, unknown>;
  const prevGeminiMeta = (prevOcr.geminiMeta ?? {}) as {
    pharma?: string;
    period?: string;
    periodRaw?: string;
    summary?: Partial<RxExtractResult["summary"]>;
  };
  const oldBatchId = typeof prevOcr.sheetBatchId === "string" ? prevOcr.sheetBatchId : null;

  // 3) 시트 갱신 — 옛 batchId 삭제 후 새 batchId 로 재append
  let sheetUrl: string | null = null;
  let sheetBatchId: string | null = null;
  let sheetWarning: string | null = null;
  let deletedSummary = 0;
  let deletedDrugs = 0;
  try {
    const payload: RxExtractResult = {
      pharma: existing.companyName || prevGeminiMeta.pharma || "",
      period: prevGeminiMeta.period || "",
      periodRaw: prevGeminiMeta.periodRaw || "",
      hospital: existing.hospitalName || "",
      summary: {
        drugCount: rows.length,
        totalPrescriptions: prevGeminiMeta.summary?.totalPrescriptions ?? 0,
        totalQuantity: rows.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0),
        totalAmountWon: Math.round(totalFee),
      },
      drugs: rows.map((r) => ({
        name: r.productName,
        code: r.insuranceCode,
        companyName: r.companyName,
        quantity: parseFloat(r.quantity) || 0,
        prescriptions: 0,
        unitPrice: r.unitPrice,
        totalPrice: r.totalPrice,
        category: "",
        efficacy: "",
        bbox: [0, 0, 0, 0] as [number, number, number, number],
      })),
    };

    if (oldBatchId) {
      const r = await replaceRxStats(oldBatchId, payload, "manual");
      sheetUrl = r.spreadsheetUrl;
      sheetBatchId = r.batchId;
      deletedSummary = r.deletedSummary;
      deletedDrugs = r.deletedDrugs;
    } else {
      // 옛 batchId 없는 행 (초기 fusion 시절 또는 일부 흐름) — append 만
      const { appendRxStats } = await import("@/lib/google-sheets-rx-append");
      const r = await appendRxStats(payload, "manual");
      sheetUrl = r.spreadsheetUrl;
      sheetBatchId = r.batchId;
    }
  } catch (e) {
    sheetWarning = `시트 갱신 실패: ${String(e).slice(0, 200)}`;
  }

  // 4) DB 업데이트 — 새 sheetBatchId + 재계산된 quality 지표 반영
  const updated = await prisma.prescriptionReport.update({
    where: { id: reportId },
    data: {
      companyName: dominantCompany,
      ocrData: {
        ...prevOcr,
        finalDrugs,
        aiDrugs: finalDrugs,
        avgConfidence,
        manualCheckCount,
        totalSumCheck,
        companiesInPhoto,
        sheetBatchId,
        sheetUrl,
      },
      totalFee,
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({
    success: true,
    reportId: updated.id,
    totalFee,
    rowCount: rows.length,
    sheetUrl,
    sheetBatchId,
    sheetWarning,
    deletedSummary,
    deletedDrugs,
  });
}
