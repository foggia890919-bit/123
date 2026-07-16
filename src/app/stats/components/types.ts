// Types shared across stats components

import type { RxRowStatus, RxRowVerification } from "@/lib/rx-verify";
export type { RxRowStatus, RxRowVerification } from "@/lib/rx-verify";

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
  // Gemini 실좌표 bbox [x1,y1,x2,y2] (0~1). 사진 위 실위치 하이라이트용. 옛 데이터는 없을 수 있음.
  bbox?: [number, number, number, number];
  // 수량(총사용량) 값 셀의 실좌표 [x1,y1,x2,y2] (0~1). 하이라이트/스크롤의 우선 기준점. 없으면 행 bbox 폴백.
  qtyBbox?: [number, number, number, number] | null;
  // 이중 검산 3단계 상태 (verified/mismatch/unreadable) + 상세.
  rowStatus?: RxRowStatus;
  verify?: RxRowVerification;
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
  bboxYPercent: number | null;   // 이미지 내 행 Y 위치 (%) — 옛 방식(폴백)
  // 실좌표 bbox — 사진 위 실위치 하이라이트 + 자동 스크롤용. 행 이동/재정렬해도 이 행에 붙어 다님.
  bbox?: [number, number, number, number] | null;
  // 수량 값 셀 실좌표 — 실무 입력값(수량) 위치. 하이라이트/스크롤 우선 기준. 없으면 bbox 폴백.
  qtyBbox?: [number, number, number, number] | null;
  // OCR 시점 3단계 검산 상태 스냅샷 — 행 색상/배지용. 사용자가 직접 추가한 행은 null/없음.
  rowStatus?: RxRowStatus | null;
  verify?: RxRowVerification | null;
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
  return { insuranceCode: "", companyName: "", productName: "", quantity: "", unitPrice: null, commissionRate: null, additionalRate: null, matchedMedicationId: null, bboxYPercent: null, bbox: null, qtyBbox: null, rowStatus: null, verify: null };
}
