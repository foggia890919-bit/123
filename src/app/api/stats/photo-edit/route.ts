import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { replaceRxStats } from "@/lib/google-sheets-rx-append";
import type { RxExtractResult } from "@/lib/gemini-rx-stats-extract";

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

  // 2) DB 의 ocrData 갱신 — finalDrugs / aiDrugs 5컬럼 구조 호환
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
  const totalFee = rows.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0);

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

  // 4) DB 업데이트 — 새 sheetBatchId 반영
  const updated = await prisma.prescriptionReport.update({
    where: { id: reportId },
    data: {
      ocrData: {
        ...prevOcr,
        finalDrugs,
        aiDrugs: finalDrugs,
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
