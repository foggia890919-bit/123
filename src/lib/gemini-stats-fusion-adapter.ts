import { extractRxStatsFromImage, type RxExtractResult, type RxDrugRow } from "./gemini-rx-stats-extract";
import { fetchMasterByCodes, fetchMasterByNamePrefixes, matchMedication, type MergedDrug } from "./medication-master-match";
import { fetchRateEntries } from "./rate-utils";
import { computeRowQuality, checkTotalSum, type RowQualityChecks, type QualityCheck } from "./rx-quality-checks";

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
  // 0~100 가중 평균 점수 — 마스터 매칭(50) + prefix(15) + 단가검증(20) + 매출검증(15).
  // 검수 UI confidenceColor() threshold 90/75 와 호환.
  finalConfidence: number;
  manualCheck: boolean;
  bboxYPercent: number | null;
  debug: null;
  mismatch:
    | { kind: "code-name-mismatch"; masterProductName: string; ocrProductName: string }
    | null;
  // Gemini 추출 companyName 과 마스터 매칭 companyName 이 다를 때만 표시. 검수에서 사람이 판단.
  companyNameMismatch:
    | { geminiCompanyName: string; masterCompanyName: string }
    | null;
  // 행별 4가지 검증 결과 — 검수 UI 가 빨강/노랑 강조하기 위한 데이터.
  qualityChecks: RowQualityChecks;
  // Case B 자동 교체된 약품명의 원본 OCR 값 (호버 툴팁 노출용).
  originalProductName: string;
  nameAutoReplaced: boolean;
  // Gemini bbox [x1, y1, x2, y2] 비율 0~1 — 검수 페이지에서 표 행 ↔ 사진 위치 매칭용
  bbox: [number, number, number, number];
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
  // 사진 단위 합계 검증 — Gemini summary.totalAmountWon 과 행 합산 매출. 5% 허용.
  totalSumCheck: QualityCheck;
  // 사진 안에 등장한 모든 제약사 (행별 companyName 의 set). N제약사 사진 진단용.
  companiesInPhoto: string[];
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

  // 2) 보험코드 9자리 일괄 조회 + 제품명 prefix 폴백 조회 (코드 매칭 실패 행 backfill).
  const codes = rx.drugs
    .map((d) => d.code.replace(/\D/g, ""))
    .filter((c) => c.length === 9);
  const names = rx.drugs.map((d) => d.name).filter(Boolean);
  const [masterByCode, masterByName] = await Promise.all([
    fetchMasterByCodes(codes),
    fetchMasterByNamePrefixes(names),
  ]);

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
      // Gemini 행별 companyName 우선. 비어 있으면 마스터 매칭이 채워줌.
      // 둘 다 있고 다르면 아래에서 mismatch flag 켜고 검수에서 사람이 판단.
      companyName: d.companyName,
      quantity: String(d.quantity ?? ""),
      confidence: d.code ? 90 : 60,
      priceHint: d.unitPrice || undefined,
    };
    const match = matchMedication(merged, masterByCode, masterByName);

    if (match.matchedMedicationId) matchedCount++; else unmatchedCount++;

    const codeOk = match.matchedMedicationId !== null && d.code.replace(/\D/g, "").length === 9;
    const hasName = !!match.productName;
    const hasQty = (d.quantity ?? 0) > 0;
    const finalUnitPrice = match.unitPrice ?? (d.unitPrice || null);

    // 0~100 가중 평균 — 마스터(50) + prefix(15) + 단가(20) + 매출(15)
    const { checks, score } = computeRowQuality({
      matchedMedicationId: match.matchedMedicationId,
      codeOk,
      // 자동 교체된 case B 는 마스터값으로 교체되어 최종 이름은 일치 — nameSimilar=true.
      nameSimilar: !!match.matchedMedicationId && (match.nameCodeMismatch == null || match.nameAutoReplaced),
      masterProductName: match.productName,
      ocrProductName: d.name,
      quantity: d.quantity ?? 0,
      geminiUnitPrice: d.unitPrice || undefined,
      masterUnitPrice: match.unitPrice,
      geminiTotalPrice: d.totalPrice || undefined,
      finalUnitPrice,
    });

    const additionalRate = additionalByCompany.get(normCompany(match.companyName)) ?? null;

    // companyName mismatch: Gemini 가 추출한 값과 마스터 매칭값이 둘 다 있는데 다른 경우.
    // 검수에서 사람이 결정 — 자동 선택 X.
    const geminiCompany = d.companyName.trim();
    const masterCompany = (match.companyName || "").trim();
    const companyNameMismatch =
      geminiCompany && masterCompany &&
      normCompany(geminiCompany) !== normCompany(masterCompany)
        ? { geminiCompanyName: geminiCompany, masterCompanyName: masterCompany }
        : null;

    return {
      insuranceCode: {
        value: match.insuranceCode,
        confidence: codeOk ? 95 : (d.code ? 60 : 0),
      },
      companyName: {
        // Gemini 가 추출한 값 우선 (사진 실제). 없으면 마스터 매칭값.
        value: geminiCompany || masterCompany,
        confidence: geminiCompany ? 90 : (masterCompany ? 60 : 0),
      },
      productName: {
        value: match.productName,
        confidence: hasName ? 90 : 0,
      },
      quantity: {
        value: String(d.quantity ?? ""),
        confidence: hasQty ? 90 : 30,
      },
      unitPrice: finalUnitPrice,
      commissionRate: match.commissionRate,
      additionalRate,
      matchedMedicationId: match.matchedMedicationId,
      finalConfidence: score.overall,
      manualCheck: score.overall < 90,
      bboxYPercent: fallbackY(i, n),
      debug: null,
      mismatch: match.nameCodeMismatch
        ? { kind: "code-name-mismatch" as const, ...match.nameCodeMismatch }
        : null,
      companyNameMismatch,
      qualityChecks: checks,
      originalProductName: match.originalProductName,
      nameAutoReplaced: match.nameAutoReplaced,
      bbox: d.bbox,
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

  // 사진 단위 합계 검증 — Gemini summary.totalAmountWon 과 행 합산 매출 비교 (Gemini 추출값 기준).
  const rowSumFromGemini = rx.drugs.reduce((s, d) => s + (d.totalPrice || 0), 0);
  const totalSumCheck = checkTotalSum(rowSumFromGemini, rx.summary.totalAmountWon);

  // 사진 안에 등장한 모든 제약사 — N제약사 사진 진단용 (Gemini 행별 companyName + 마스터 보강값 둘 다).
  const companySet = new Set<string>();
  for (const fd of drugs) {
    const v = fd.companyName.value.trim();
    if (v) companySet.add(v);
  }
  const companiesInPhoto = Array.from(companySet);

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
    totalSumCheck,
    companiesInPhoto,
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
