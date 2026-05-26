// Types shared across stats components

export interface OcrField { value: string; confidence: number }
export interface DrugDebug {
  anchorXPct: number;
  anchorTopPct: number;
  anchorBotPct: number;
  slopePerWidth: number;
  qtyBoxPct: { left: number; top: number; right: number; bottom: number } | null;
}
export interface FusionDrug {
  insuranceCode: OcrField;
  companyName: OcrField;
  productName: OcrField;
  quantity: OcrField;
  unitPrice: number | null;
  commissionRate: number | null;
  additionalRate: number | null;
  matchedMedicationId: string | null;
  finalConfidence: number;
  manualCheck: boolean;
  bboxYPercent: number | null;
  debug: DrugDebug | null;
  mismatch?: {
    kind: "code-name-mismatch";
    masterProductName: string;
    ocrProductName: string;
  } | null;
}
// 서버의 EmrVendor / CaptureType 과 동기화 — 새 EMR 추가 시 ocr-vendor-classifier.ts 와 같이 수정.
export type EmrVendor =
  | "doctor" | "doctor2" | "u-pharm" | "eghis" | "nh-pharm"
  | "chartfree" | "emrpro" | "biit" | "dubeone" | "pharm-it3000" | "unknown";
export type CaptureType = "photo" | "screenshot" | "monitor";

export const VENDOR_LABEL_KO: Record<EmrVendor, string> = {
  doctor: "의사랑 v1",
  doctor2: "의사랑 v2",
  "u-pharm": "U pharm system",
  eghis: "eGhis 통합",
  "nh-pharm": "NH팜",
  chartfree: "차트프리",
  emrpro: "EMRpro",
  biit: "비트",
  dubeone: "두번에",
  "pharm-it3000": "PHARM IT3000 (약국)",
  unknown: "알 수 없음",
};

export const CAPTURE_LABEL_KO: Record<CaptureType, string> = {
  photo: "종이 사진",
  screenshot: "스크린샷",
  monitor: "모니터 촬영",
};

export interface ColumnTemplate {
  insuranceCode: number | null;
  productName: number | null;
  patientCount: number | null;
  unitPrice: number | null;
  quantity: number | null;
  total: number | null;
  detectedAt: string;
  source: "auto" | "manual" | "cached";
  vendor?: EmrVendor;
  captureType?: CaptureType;
}
export interface PipelineDiagnostics {
  vendor: EmrVendor;
  captureType: CaptureType;
  vendorConfidence: number;
  vendorRationale: string;
  vendorError: string | null;
  cachedTemplateVendor: EmrVendor | null;
  cacheHit: boolean;
  cacheRejectReason: string | null;
  clovaOk: boolean;
  clovaChars: number;
  clovaError: string | null;
  visionOk: boolean;
  visionDrugCount: number;
  visionError: string | null;
  mergeUsed: string;
  mergeDrugCount: number;
  mergeError: string | null;
  filteredByIsLikelyDrug: number;
  masterMatchedCount: number;
  masterUnmatchedCount: number;
  dedupedCount: number;
  finalCount: number;
  columnCounts?: {
    insuranceCode9digit: number;
    visionRows: number;
    positionalRows: number;
    mismatch: boolean;
  };
  nameCodeMismatchCount?: number;
  drugCandidates?: Array<{
    text: string;
    yPercent: number;
    xPercent: number;
    accepted: boolean;
    droppedReason: string | null;
    slope?: number;
    quantity?: string;
    quantityY?: number;
    insuranceCode?: string;
  }>;
  masterUnmatchedSamples?: Array<{ productName: string; unitPriceHint: number | null }>;
  crossValidation?: Array<{
    insuranceCode: string;
    productName: string;
    positionalQuantity: string;
    visionQuantity: string;
    match: boolean;
  }>;
  // Document AI 진단 (있을 수도 없을 수도)
  docaiOk?: boolean;
  docaiConfigured?: boolean;
  docaiTableCount?: number;
  docaiTotalRowCount?: number;
  docaiTextChars?: number;
  docaiError?: string | null;
  docaiSampleTable?: string[][] | null;
}
export interface OcrResult {
  source: string;
  vendor: EmrVendor;
  captureType: CaptureType;
  drugs: FusionDrug[];
  avgConfidence: number;
  manualCheckCount: number;
  rawClovaText?: string;
  rawGeminiText?: string;
  hospitalName: OcrField;
  columnTemplate: ColumnTemplate | null;
  pipeline?: PipelineDiagnostics;
  // Gemini-direct 백엔드가 사진 상단 합계의 약품수와 실제 추출 행 수가 다를 때 채움.
  // 사용자가 일부 행 누락을 즉시 인지할 수 있게 경고 배너 노출 (단건/배치 양쪽).
  partialExtraction?: { detected: number; extracted: number } | null;
}
export interface ManualDrug {
  insuranceCode: string;
  companyName: string;
  productName: string;
  quantity: string;
  unitPrice: number | null;
  commissionRate: number | null;
  additionalRate: number | null;
  matchedMedicationId: string | null;
  bboxYPercent: number | null;   // 이미지 내 행 Y 위치 (%) — 셀 포커스 시 이미지 자동 추적용
}
export interface UserClient {
  id: string; clientName: string; bizNumber: string; approved: boolean;
}

export interface AutocompleteOption {
  id: string;
  insuranceCode: string | null;
  productName: string;
  companyName: string;
  price: number | null;
  commissionRate: number | null;
  additionalRate: number | null;
}

export function emptyManualDrug(): ManualDrug {
  return { insuranceCode: "", companyName: "", productName: "", quantity: "", unitPrice: null, commissionRate: null, additionalRate: null, matchedMedicationId: null, bboxYPercent: null };
}
