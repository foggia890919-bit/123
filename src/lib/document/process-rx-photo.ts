// 처방통계 사진 분석 백그라운드 헬퍼 — Gemini Vision + 마스터 매칭 + 자가검증 + 시트 저장 + DB update.
// 신규 업로드(photo-auto) 와 재분석(photo-retry) 모두 이 함수를 호출.
//
// 입력: PrescriptionReport.id + 사진 base64/mimeType + 메타.
// 동작: Gemini 분석 → 약품 0건이면 status=ERROR, 아니면 마스터 매칭 + self-validate + 시트 저장 → status=PENDING_REVIEW.
// 예외: 어떤 단계든 실패 시 status=ERROR + ocrData.error 에 메시지 기록.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extractRxStatsFromImage } from "@/lib/ai/gemini-rx-stats-extract";
import {
  fetchMasterByCodes,
  fetchMasterByNamePrefixes,
  matchMedication,
  type MergedDrug,
  type MatchResult,
  type ValidationResult,
} from "@/lib/medication-master-match";
import { runSelfValidateBatch, type SelfValidateMeta } from "@/lib/ai/gemini-self-validate";
import { verifyRxRow } from "@/lib/rx-verify";
import { regularizeBboxes } from "@/lib/bbox-regularize";
import { readWithClova } from "@/lib/ai/clova-ocr";
import { dualRead, type DualReadInfo, type DualReadStats } from "@/lib/dual-read";
import { appendRxStats } from "@/lib/google/google-sheets-rx-append";
import { fetchRateEntries } from "@/lib/rate-utils";
import { computeRowQuality, checkTotalSum } from "@/lib/rx-quality-checks";
import { companyNameKey } from "@/lib/company-name";

export interface ProcessRxPhotoArgs {
  reportId: string;
  base64: string;
  mimeType: string;
  userId: string;
  clientName: string;
  fileName: string;
}

export async function processRxPhoto(args: ProcessRxPhotoArgs): Promise<void> {
  const { reportId, base64, mimeType, userId, clientName, fileName } = args;

  // 기존 ocrData 보존용 (imageHash 등 메타)
  const existing = await prisma.prescriptionReport.findUnique({
    where: { id: reportId },
    select: { ocrData: true },
  });
  const baseOcr = (existing?.ocrData ?? {}) as Record<string, unknown>;

  try {
    // Gemini + 클로바 OCR 병렬 시작 (둘 다 이미지만 필요).
    const clovaPromise = readWithClova(base64, mimeType); // 실패해도 null
    const { data: rx } = await extractRxStatsFromImage(base64, mimeType);
    const clova = await clovaPromise;
    if (rx.drugs.length === 0) {
      await prisma.prescriptionReport.update({
        where: { id: reportId },
        data: {
          status: "ERROR",
          ocrData: {
            ...baseOcr,
            error: "약품 0건 — Gemini 가 사진에서 약품 인식 실패",
            processingEndedAt: new Date().toISOString(),
          } as unknown as Prisma.InputJsonObject,
        },
      });
      return;
    }

    const codes = rx.drugs.map((d) => d.code.replace(/\D/g, "")).filter((c) => c.length === 9);
    const names = rx.drugs.map((d) => d.name).filter(Boolean);
    const [masterByCode, masterByName] = await Promise.all([
      fetchMasterByCodes(codes),
      fetchMasterByNamePrefixes(names),
    ]);

    // 클로바 이중 판독 — 보험코드 앵커로 행 매칭 → 숫자 교차검증/채택 + 좌표 교체.
    let dualReadStats: DualReadStats | null = null;
    let dualInfos: DualReadInfo[] = [];
    let lockedIndices: Set<number> | undefined;
    if (clova) {
      const masterUnitPriceByCode = new Map(
        Array.from(masterByCode.entries()).map(([code, m]) => [code, m.price] as [string, number | null]),
      );
      const dr = dualRead(rx.drugs, clova, masterUnitPriceByCode);
      rx.drugs = dr.drugs;
      dualInfos = dr.infos;
      lockedIndices = dr.lockedIndices;
      dualReadStats = dr.stats;
    }
    // 행별 bbox/qtyBbox 격자 스냅 — 클로바 좌표 없는 행만 보정 (locked 행은 실측 유지).
    rx.drugs = regularizeBboxes(rx.drugs, lockedIndices);

    const rateEntries = await fetchRateEntries(userId);
    const additionalByCompany = new Map(
      rateEntries.map((r) => [companyNameKey(r.companyName), r.additionalRate]),
    );

    const matchResults: MatchResult[] = [];
    const finalDrugs = rx.drugs.map((d, idx) => {
      const merged: MergedDrug = {
        insuranceCode: d.code,
        productName: d.name,
        companyName: d.companyName,
        quantity: String(d.quantity ?? ""),
        confidence: d.code ? 90 : 60,
        priceHint: d.unitPrice || undefined,
      };
      const match = matchMedication(merged, masterByCode, masterByName);
      matchResults[idx] = match;
      const additionalRate = additionalByCompany.get(companyNameKey(match.companyName)) ?? null;
      const codeOk = match.matchedMedicationId !== null && d.code.replace(/\D/g, "").length === 9;
      const finalUnitPrice = match.unitPrice ?? (d.unitPrice || null);

      const { checks, score } = computeRowQuality({
        matchedMedicationId: match.matchedMedicationId,
        codeOk,
        nameSimilar: !!match.matchedMedicationId && (match.nameCodeMismatch == null || match.nameAutoReplaced),
        masterProductName: match.productName,
        ocrProductName: d.name,
        quantity: d.quantity ?? 0,
        geminiUnitPrice: d.unitPrice || undefined,
        masterUnitPrice: match.unitPrice,
        geminiTotalPrice: d.totalPrice || undefined,
        finalUnitPrice,
      });

      const geminiCompany = d.companyName.trim();
      const masterCompany = (match.companyName || "").trim();
      const companyNameMismatch =
        geminiCompany && masterCompany &&
        companyNameKey(geminiCompany) !== companyNameKey(masterCompany)
          ? { geminiCompanyName: geminiCompany, masterCompanyName: masterCompany }
          : null;

      // 이중 검산(산술 A + 마스터약가 B) → 3단계 상태 (verified / mismatch / unreadable).
      // Gemini 원본 값(판독 불가면 null)을 넣어 unreadable 을 정확히 잡는다.
      const verify = verifyRxRow({
        quantity: d.quantity,
        unitPrice: d.unitPrice,
        totalPrice: d.totalPrice,
        insuranceCode: d.code,
        productName: d.name,
        masterUnitPrice: match.unitPrice,
      });
      // 클로바 이중 판독 교차검증 결과 병합.
      verify.dualRead = dualInfos[idx] ?? null;

      // reviewReason 우선순위: 판독불가 > 검산불일치 > 코드-이름 불일치 > 자가검증(뒤에서 덮어씀)
      const initReviewReason: string | null =
        verify.status === "unreadable" ? "unreadable"
        : verify.status === "mismatch" ? "verifyMismatch"
        : match.nameCodeMismatch && !match.nameAutoReplaced ? "nameCodeMismatch"
        : null;

      return {
        insuranceCode: match.insuranceCode,
        companyName: geminiCompany || masterCompany,
        productName: match.productName,
        quantity: String(d.quantity ?? ""),
        unitPrice: finalUnitPrice,
        // OCR 원본 약가 (Gemini Vision 이 사진에서 직접 읽은 값) — 단가 셀 dot 표시용
        originalUnitPrice: d.unitPrice || null,
        priceAutoReplaced: !!(match.unitPrice && d.unitPrice && match.unitPrice !== d.unitPrice),
        commissionRate: match.commissionRate,
        additionalRate,
        matchedMedicationId: match.matchedMedicationId,
        finalConfidence: score.overall,
        bboxYPercent: null,
        bbox: d.bbox,
        qtyBbox: d.qtyBbox,
        rowStatus: verify.status,
        verify,
        mismatch: match.nameCodeMismatch
          ? { kind: "code-name-mismatch" as const, ...match.nameCodeMismatch }
          : null,
        companyNameMismatch,
        qualityChecks: checks,
        originalProductName: match.originalProductName,
        nameAutoReplaced: match.nameAutoReplaced,
        reviewReason: initReviewReason as string | null,
        validation: null as ValidationResult | null,
      };
    });

    let selfValidateMeta: SelfValidateMeta | null = null;
    try {
      const batchResult = await runSelfValidateBatch(
        rx.drugs.map((d, idx) => ({
          index: idx,
          matchResult: matchResults[idx],
          ocrInsuranceCode: d.code,
          ocrProductName: d.name,
          ocrUnitPrice: d.unitPrice || null,
        })),
      );
      selfValidateMeta = batchResult.meta;
      for (const [idx, v] of batchResult.validations) {
        // 이중 검산이 이미 unreadable/mismatch 로 잡은 행은 그 사유를 유지 (자가검증이 덮지 않음).
        if (finalDrugs[idx].rowStatus === "verified") {
          finalDrugs[idx].reviewReason = "selfValidateMismatch";
        }
        finalDrugs[idx].validation = v;
      }
    } catch (selfErr) {
      console.error("[processRxPhoto self-validate]", reportId, String(selfErr).slice(0, 300));
    }

    const totalFee = finalDrugs.reduce((s, d) => {
      const qty = parseFloat(d.quantity) || 0;
      const unit = d.unitPrice ?? 0;
      return s + qty * unit;
    }, 0);

    const avgConfidence = finalDrugs.length
      ? Math.round(finalDrugs.reduce((s, d) => s + d.finalConfidence, 0) / finalDrugs.length)
      : 0;
    const manualCheckCount = finalDrugs.filter((d) => d.finalConfidence < 90).length;

    const rowSumGemini = rx.drugs.reduce((s, d) => s + (d.totalPrice || 0), 0);
    const totalSumCheck = checkTotalSum(rowSumGemini, rx.summary.totalAmountWon);

    const companySet = new Set<string>();
    for (const fd of finalDrugs) {
      const v = fd.companyName.trim();
      if (v) companySet.add(v);
    }
    const companiesInPhoto = Array.from(companySet);

    const companyRowCount = new Map<string, number>();
    for (const fd of finalDrugs) {
      const k = fd.companyName.trim();
      if (!k) continue;
      companyRowCount.set(k, (companyRowCount.get(k) ?? 0) + 1);
    }
    const dominantCompany = Array.from(companyRowCount.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? rx.pharma ?? "";

    // 사용자가 업로드 시 제약사를 지정했으면(declaredCompany) OCR dominant 로 덮지 않고 유지.
    // dominant 와 declared 가 다르면 검수 화면이 쓸 수 있게 경고만 기록.
    const declaredCompany = typeof baseOcr.declaredCompany === "string" ? baseOcr.declaredCompany.trim() : "";
    const finalCompanyName = declaredCompany || dominantCompany;
    const companyMismatchWarning =
      declaredCompany && dominantCompany &&
      companyNameKey(declaredCompany) !== companyNameKey(dominantCompany)
        ? { declared: declaredCompany, dominant: dominantCompany }
        : null;

    let sheetUrl: string | null = null;
    let sheetBatchId: string | null = null;
    let sheetWarning: string | null = null;
    try {
      const sheet = await appendRxStats(
        {
          pharma: rx.pharma,
          period: rx.period,
          periodRaw: rx.periodRaw,
          hospital: clientName,
          summary: {
            drugCount: rx.drugs.length,
            totalPrescriptions: rx.summary.totalPrescriptions,
            totalQuantity: rx.summary.totalQuantity,
            totalAmountWon: Math.round(totalFee),
          },
          drugs: rx.drugs,
        },
        "manual",
      );
      sheetUrl = sheet.spreadsheetUrl;
      sheetBatchId = sheet.batchId;
    } catch (e) {
      sheetWarning = String(e).slice(0, 200);
    }

    await prisma.prescriptionReport.update({
      where: { id: reportId },
      data: {
        status: "PENDING_REVIEW",
        companyName: finalCompanyName,
        totalFee,
        ocrData: {
          source: "gemini-direct-photo-auto",
          vendor: "unknown",
          captureType: "photo",
          imageHash: baseOcr.imageHash ?? null,    // 중복 차단용 보존
          // 행 단위 업로드 메타 보존 + dominant≠declared 경고.
          declaredCompany: declaredCompany || null,
          submissionEntity: baseOcr.submissionEntity ?? null,
          dominantCompany,
          companyMismatchWarning,
          finalDrugs,
          aiDrugs: finalDrugs,
          avgConfidence,
          manualCheckCount,
          totalSumCheck,
          companiesInPhoto,
          dualReadStats,
          geminiMeta: {
            pharma: rx.pharma,
            period: rx.period,
            periodRaw: rx.periodRaw,
            summary: rx.summary,
          },
          sheetBatchId,
          sheetUrl,
          sheetWarning,
          fileName,
          processingEndedAt: new Date().toISOString(),
          selfValidate: selfValidateMeta,
        } as unknown as Prisma.InputJsonObject,
        updatedAt: new Date(),
      },
    });
  } catch (e) {
    try {
      await prisma.prescriptionReport.update({
        where: { id: reportId },
        data: {
          status: "ERROR",
          ocrData: {
            ...baseOcr,
            error: String(e).slice(0, 500),
            processingEndedAt: new Date().toISOString(),
          } as unknown as Prisma.InputJsonObject,
        },
      });
    } catch (updateErr) {
      console.error("[processRxPhoto fail update]", reportId, String(updateErr).slice(0, 200));
    }
  }
}
