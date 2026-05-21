import { extractRxStatsFromImage, type RxExtractResult, type RxDrugRow } from "./gemini-rx-stats-extract";
import { fetchMasterByCodes, matchMedication, type MergedDrug } from "./medication-master-match";
import { fetchRateEntries } from "./rate-utils";

// stats/page.tsx 가 자체 재정의해서 쓰는 JSON 응답 형식. import 의존성 없음 — 응답 형식만 호환.
// 핵심 필드: drugs[].{insuranceCode, companyName, productName, quantity (Field), unitPrice,
//   commissionRate, additionalRate, matchedMedicationId, finalConfidence, manualCheck,
//   bboxYPercent, debug, mismatch }, hospitalName, avgConfidence, manualCheckCount, pipeline.

interface Field { value: string; confidence: number }

interface FusionDrug {
  insuranceCode: Field;
  companyName: Field;
  productName: Field;
  quantity: Field;
  unitPrice: number | null;
  commissionRate: number | null;
  additionalRate: number | null;
  matchedMedicationId: string | null;
  finalConfidence: number;
  manualCheck: boolean;
  bboxYPercent: number | null;
  debug: null;
  mismatch:
    | { kind: "code-name-mismatch"; masterProductName: string; ocrProductName: string }
    | null;
}

export interface FusionResultJson {
  source: "gemini-direct";
  vendor: "unknown";
  captureType: "photo";
  drugs: FusionDrug[];
  avgConfidence: number;
  manualCheckCount: number;
  rawClovaText: "";
  rawGeminiText: string;
  hospitalName: Field;
  columnTemplate: null;
  pipeline: Record<string, unknown>;
  institutionCode: Field;
  prescriptionDate: Field;
  patientName: Field;
  // QA 권장 신규 필드 — 부분 추출 감지용. stats/page.tsx 가 사진 약품수 vs 추출 행 수 다를 때 경고 배너.
  partialExtraction:
    | { detected: number; extracted: number }
    | null;
  // 새 /stats/photo 페이지가 시트 append 시 카테고리/효능/처방횟수 원본 보존하려고 사용.
  // 기존 /stats 페이지는 이 필드 무시 (5컬럼만 보고 무관).
  rawDrugs: RxDrugRow[];
  // Gemini 가 자체 분석한 메타 (참고용, hidden 영역 진단 박스에 표시 가능)
  geminiMeta: {
    pharma: string;
    period: string;
    periodRaw: string;
    summary: RxExtractResult["summary"];
    durationMs: number;
    model: string;
  };
}

function normCompany(s: string): string {
  return s.replace(/\(주\)|\(유\)|주식회사|㈜|\s+/g, "").toLowerCase();
}

// Y 좌표가 없어서 인덱스 비례로 fallback (10~90% 균등). 기존 OCR 의 fallbackY 와 동일 공식.
function fallbackY(i: number, n: number): number {
  if (n <= 1) return 50;
  return Math.round((10 + (i / (n - 1)) * 80) * 10) / 10;
}

// hidden 진단 박스를 위한 안전한 빈 pipeline 객체. 모든 필드를 기본값으로.
function buildPipeline(rx: RxExtractResult, geminiDurationMs: number, matchedCount: number, unmatchedCount: number) {
  return {
    vendor: "unknown" as const,
    captureType: "photo" as const,
    vendorConfidence: 0,
    vendorRationale: "Gemini-direct (벤더 분류 없음)",
    vendorError: null,
    cachedTemplateVendor: null,
    cacheHit: false,
    cacheRejectReason: "Gemini-direct 백엔드 — ColumnTemplate 캐시 사용 안 함",
    clovaOk: false,
    clovaChars: 0,
    clovaError: null,
    visionOk: true,
    visionDrugCount: rx.drugs.length,
    visionError: null,
    mergeUsed: "gemini-direct",
    mergeDrugCount: rx.drugs.length,
    mergeError: null,
    filteredByIsLikelyDrug: 0,
    masterMatchedCount: matchedCount,
    masterUnmatchedCount: unmatchedCount,
    masterUnmatchedSamples: [],
    crossValidation: [],
    dedupedCount: 0,
    finalCount: rx.drugs.length,
    columnCounts: {
      insuranceCode9digit: rx.drugs.filter((d) => d.code.replace(/\D/g, "").length === 9).length,
      visionRows: rx.drugs.length,
      positionalRows: 0,
      mismatch: false,
    },
    nameCodeMismatchCount: 0,
    drugCandidates: [],
    docaiOk: false,
    docaiConfigured: false,
    docaiTableCount: 0,
    docaiTotalRowCount: 0,
    docaiTextChars: 0,
    docaiError: null,
    docaiSampleTable: null,
    geminiDurationMs,
  };
}

// 핵심 진입점: 이미지 base64 → Gemini 멀티모달 → 마스터 매칭/수수료 보정 → 기존 OCR 응답 형식 호환 JSON.
export async function extractStatsLikeFusion(
  base64: string,
  mimeType: string,
  userId: string,
): Promise<FusionResultJson> {
  // 1) Gemini 한 번 호출 — 사진 전체 표 추출.
  const { data: rx, debug } = await extractRxStatsFromImage(base64, mimeType);

  // 2) 보험코드 9자리 일괄 조회.
  const codes = rx.drugs
    .map((d) => d.code.replace(/\D/g, ""))
    .filter((c) => c.length === 9);
  const masterByCode = await fetchMasterByCodes(codes);

  // 3) 사용자별 추가 수수료 (개인 → 부모법인 폴백) 한 번에 로드.
  const rateEntries = await fetchRateEntries(userId);
  const additionalByCompany = new Map(
    rateEntries.map((r) => [normCompany(r.companyName), r.additionalRate]),
  );

  // 4) 행별 마스터 매칭 + Field 형식 매핑.
  let matchedCount = 0;
  let unmatchedCount = 0;
  const n = rx.drugs.length;

  const drugs: FusionDrug[] = rx.drugs.map((d, i) => {
    const merged: MergedDrug = {
      insuranceCode: d.code,
      productName: d.name,
      companyName: "",          // Gemini 가 약품별 제약사 별도로 안 뽑음 — 마스터 매칭이 보강
      quantity: String(d.quantity ?? ""),
      confidence: d.code ? 90 : 60,
      priceHint: d.unitPrice || undefined,
    };
    const match = matchMedication(merged, masterByCode);

    if (match.matchedMedicationId) matchedCount++; else unmatchedCount++;

    const codeOk = match.matchedMedicationId !== null;
    const hasName = !!match.productName;
    const hasQty = (d.quantity ?? 0) > 0;
    // 단순 3단계: 코드+이름+수량 다 있으면 95, 코드만 있으면 70, 아무것도 없으면 40
    const finalConfidence = codeOk
      ? 95
      : (d.code && hasName ? 70 : 40);

    const additionalRate = additionalByCompany.get(normCompany(match.companyName)) ?? null;

    return {
      insuranceCode: {
        value: match.insuranceCode,
        confidence: codeOk ? 95 : (d.code ? 60 : 0),
      },
      companyName: {
        value: match.companyName,
        confidence: match.companyName ? 90 : 0,
      },
      productName: {
        value: match.productName,
        confidence: hasName ? 90 : 0,
      },
      quantity: {
        value: String(d.quantity ?? ""),
        confidence: hasQty ? 90 : 30,
      },
      unitPrice: match.unitPrice ?? (d.unitPrice || null),
      commissionRate: match.commissionRate,
      additionalRate,
      matchedMedicationId: match.matchedMedicationId,
      finalConfidence,
      manualCheck: finalConfidence < 95,
      bboxYPercent: fallbackY(i, n),
      debug: null,
      mismatch: match.nameCodeMismatch
        ? { kind: "code-name-mismatch" as const, ...match.nameCodeMismatch }
        : null,
    };
  });

  const avgConfidence = drugs.length
    ? Math.round(drugs.reduce((s, d) => s + d.finalConfidence, 0) / drugs.length)
    : 0;
  const manualCheckCount = drugs.filter((d) => d.manualCheck).length;

  // 부분 추출 감지 — Gemini 가 표 상단 합계의 약품수와 실제 추출 행 수가 다르면 사용자에게 경고.
  const detected = rx.summary.drugCount;
  const extracted = drugs.length;
  const partialExtraction =
    detected > 0 && detected !== extracted ? { detected, extracted } : null;

  return {
    source: "gemini-direct",
    vendor: "unknown",
    captureType: "photo",
    drugs,
    avgConfidence,
    manualCheckCount,
    rawClovaText: "",
    rawGeminiText: JSON.stringify(rx, null, 2),
    hospitalName: { value: rx.hospital, confidence: rx.hospital ? 80 : 0 },
    columnTemplate: null,
    pipeline: buildPipeline(rx, debug.durationMs, matchedCount, unmatchedCount),
    institutionCode: { value: "", confidence: 0 },
    prescriptionDate: { value: "", confidence: 0 },
    patientName: { value: "", confidence: 0 },
    partialExtraction,
    rawDrugs: rx.drugs,
    geminiMeta: {
      pharma: rx.pharma,
      period: rx.period,
      periodRaw: rx.periodRaw,
      summary: rx.summary,
      durationMs: debug.durationMs,
      model: debug.model,
    },
  };
}
