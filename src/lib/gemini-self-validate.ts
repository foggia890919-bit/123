import { GoogleGenAI, Type } from "@google/genai";
import type { ValidationResult } from "./medication-master-match";

// Gemini 양방향 자가검증 — Vision OCR 1차 결과를 텍스트 API 로 두 방향에서 cross-check.
//
// Phase 3 (이전 Phase 2 의 단방향 + 마스터 의존 흐름을 대체):
//   - 마스터DB 매칭 여부와 무관하게 모든 행 검증 (사용자 요구: "사진 자체의 OCR 정확도")
//   - 한 호출에 양방향 질문 동시:
//       byCode: "보험코드 X 에 해당하는 정식 약품명/약가는?"
//       byName: "약품명 Y 에 해당하는 보험코드/약가는?"
//   - 사용자 명시 룰:
//       OCR 약가=0 → 약가 검증 skip
//       약품명이 실존 안 함 (Gemini hallucination 의심) → 보험코드 답을 채택
//   - 안전장치:
//       byName.exists=false 단독으로는 mismatch 격상 금지 (신약 false positive 방지)
//       OCR 값과 Gemini 답 비교는 공백 제거 + 소문자화 후 (정규 표기 차이 무시)
//       8s timeout / pLimit(2) / row > 100 kill-switch
//       응답 JSON 깨지면 null fallback — OCR row 자체는 보존

const MODEL = "gemini-3.5-flash";
const TIMEOUT_MS = 8000;
const ROW_KILL_SWITCH = 100;
const PRICE_TOLERANCE = 0.1;  // ±10% 차이 안이면 PASS

interface SelfValidatePayload {
  insuranceCode: string;
  productName: string;
  unitPrice: number | null;
}

// Gemini 가 반환하는 한 방향 답.
interface DrugAnswer {
  productName: string;
  insuranceCode: string;
  unitPrice: number;
  exists: boolean;
}

const DRUG_ANSWER_SCHEMA = {
  type: Type.OBJECT,
  required: ["productName", "insuranceCode", "unitPrice", "exists"],
  properties: {
    productName: { type: Type.STRING, description: "정식 약품명. 모르면 빈 문자열." },
    insuranceCode: { type: Type.STRING, description: "한국 EDI 보험코드 9자리. 모르면 빈 문자열." },
    unitPrice: { type: Type.NUMBER, description: "약가(원). 모르면 0." },
    exists: { type: Type.BOOLEAN, description: "이 약품을 실제로 알고 있으면 true, 모르거나 추측이면 false." },
  },
};

const SCHEMA = {
  type: Type.OBJECT,
  required: ["byCode", "byName"],
  properties: {
    byCode: DRUG_ANSWER_SCHEMA,
    byName: DRUG_ANSWER_SCHEMA,
  },
};

function buildPrompt(p: SelfValidatePayload): string {
  return [
    "다음은 한국 EMR 처방통계 사진에서 Gemini Vision OCR 로 추출한 약품 한 행이다.",
    "너의 자체 의약품 지식만으로 양방향 cross-validate 해라. 추측/환각 금지.",
    "",
    "OCR 결과:",
    `- 보험코드(EDI 9자리): ${p.insuranceCode || "(없음)"}`,
    `- 약품명: ${p.productName || "(없음)"}`,
    `- 단가(원): ${p.unitPrice ?? "(모름)"}`,
    "",
    "두 방향으로 답하라:",
    "",
    "1) byCode — 위 보험코드를 보고 너가 아는 약품 정보:",
    `   - productName: 이 보험코드의 정식 약품명. 모르면 ""`,
    `   - insuranceCode: 위 보험코드를 그대로 echo (또는 정규화한 9자리).`,
    `   - unitPrice: 너가 아는 약가(원). 모르면 0.`,
    `   - exists: 너가 실제로 이 보험코드의 약품을 안다면 true, 모르거나 추측이면 false.`,
    `   - OCR 보험코드가 빈 문자열이면 exists=false + 나머지 빈/0 으로 답하라.`,
    "",
    "2) byName — 위 약품명을 보고 너가 아는 약품 정보:",
    `   - productName: 정식 약품명 (OCR 약품명을 정규화한 표기).`,
    `   - insuranceCode: 이 약품의 EDI 9자리 보험코드. 모르면 "".`,
    `   - unitPrice: 너가 아는 약가(원). 모르면 0.`,
    `   - exists: 이 약품명이 실존하는 약품이면 true, 모르거나 가공의 이름 같으면 false.`,
    `   - OCR 약품명이 빈 문자열이면 exists=false + 나머지 빈/0 으로 답하라.`,
    "",
    "주의: 정말 알고 있는 약품만 exists=true. 모르면 정직하게 false + 빈 필드.",
  ].join("\n");
}

// 공백/대소문자 제거 정규화 — Gemini 가 "타이레놀500mg" 또는 "타이레놀 500mg" 또는 "TYLENOL 500mg"
// 같은 표기 차이로 답할 때 false positive 방지 (QA B2 fix).
function normalizeForCompare(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

// 양방향 답 + OCR 값으로 ValidationResult 만들기. mismatchFields/suggestion 결정 룰을 한 곳에 집중
// (Architect 권장 — selfValidateDrug 내부에 가둠).
function reduceToValidation(
  payload: SelfValidatePayload,
  byCode: DrugAnswer,
  byName: DrugAnswer,
): ValidationResult | null {
  const hasOcrCode = payload.insuranceCode.replace(/\D/g, "").length > 0;
  const hasOcrName = payload.productName.trim().length > 0;
  const ocrPrice = payload.unitPrice ?? 0;

  // 규칙 d (첫 절): byCode 도 byName 도 둘 다 모름 → 검증 불가, 마킹 안 함.
  // (신약/희귀약 false positive 방지 — Risk Manager 우려 흡수)
  if (!byCode.exists && !byName.exists) return null;

  const mismatchFields: ("productName" | "insuranceCode" | "unitPrice")[] = [];
  const suggestion: { productName?: string; insuranceCode?: string; unitPrice?: number } = {};

  // 규칙 e + d 의 둘째 절 통합:
  //   byCode 가 실존하는 약을 안다 + OCR 약품명이 있으면 두 표기 비교 (정규화 후).
  //   다르면 productName mismatch + 마스터 답을 suggestion 으로.
  //   byName.exists=false 인 경우 (약품명 hallucination 의심) 도 같은 분기로 처리 — 결과 같음.
  if (hasOcrName && byCode.exists && byCode.productName) {
    if (normalizeForCompare(byCode.productName) !== normalizeForCompare(payload.productName)) {
      mismatchFields.push("productName");
      suggestion.productName = byCode.productName;
    }
  }

  // 규칙 f: byName 가 실존하는 약을 안다 + OCR 보험코드가 있으면 두 코드 비교 (숫자만).
  if (hasOcrCode && byName.exists && byName.insuranceCode) {
    const ocrCodeNorm = payload.insuranceCode.replace(/\D/g, "");
    const byNameCodeNorm = byName.insuranceCode.replace(/\D/g, "");
    if (byNameCodeNorm.length === 9 && byNameCodeNorm !== ocrCodeNorm) {
      mismatchFields.push("insuranceCode");
      suggestion.insuranceCode = byNameCodeNorm;
    }
  }

  // 규칙 g: OCR 약가 > 0 + byCode 가 약가 안다 + 10% 이상 차이 → unitPrice mismatch.
  // 사용자 명시: OCR.price=0 이면 약가 검증 skip (final strip 에서 한 번 더 보장).
  if (ocrPrice > 0 && byCode.exists && byCode.unitPrice > 0) {
    const diff = Math.abs(byCode.unitPrice - ocrPrice) / ocrPrice;
    if (diff > PRICE_TOLERANCE) {
      mismatchFields.push("unitPrice");
      suggestion.unitPrice = byCode.unitPrice;
    }
  }

  // 규칙 c (final strip): OCR 약가 0 이면 unitPrice mismatch 강제 제거 — belt-and-suspenders.
  const finalMismatch = ocrPrice === 0
    ? mismatchFields.filter((f) => f !== "unitPrice")
    : mismatchFields;

  // 규칙 h: 어긋난 필드가 없으면 PASS — null 반환, 노란 마킹 안 함.
  if (finalMismatch.length === 0) return null;

  return {
    source: "gemini-self",
    mismatchFields: finalMismatch,
    suggestion,
  };
}

async function callGemini(
  payload: SelfValidatePayload,
): Promise<{ validation: ValidationResult | null; raw: { byCode: DrugAnswer; byName: DrugAnswer } | null }> {
  if (!process.env.GEMINI_API_KEY) return { validation: null, raw: null };
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: buildPrompt(payload) }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0,
    },
  });
  const text = response.text ?? "";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { validation: null, raw: null };
  }

  const byCode = hydrateAnswer(parsed.byCode);
  const byName = hydrateAnswer(parsed.byName);
  const validation = reduceToValidation(payload, byCode, byName);
  return { validation, raw: { byCode, byName } };
}

function hydrateAnswer(v: unknown): DrugAnswer {
  const obj = (v && typeof v === "object") ? v as Record<string, unknown> : {};
  const unitPriceRaw = Number(obj.unitPrice ?? 0);
  return {
    productName: String(obj.productName ?? "").trim(),
    insuranceCode: String(obj.insuranceCode ?? "").replace(/\D/g, ""),
    unitPrice: Number.isFinite(unitPriceRaw) ? unitPriceRaw : 0,
    exists: Boolean(obj.exists),
  };
}

export async function selfValidateDrug(
  payload: SelfValidatePayload,
): Promise<{ validation: ValidationResult | null; raw: { byCode: DrugAnswer; byName: DrugAnswer } | null }> {
  try {
    return await Promise.race([
      callGemini(payload),
      new Promise<{ validation: null; raw: null }>((resolve) =>
        setTimeout(() => resolve({ validation: null, raw: null }), TIMEOUT_MS),
      ),
    ]);
  } catch {
    return { validation: null, raw: null };
  }
}

// p-limit 의존성 회피용 인라인 동시성 제한기.
function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const drain = () => {
    while (active < concurrency && queue.length > 0) {
      const task = queue.shift()!;
      active++;
      task();
    }
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          drain();
        });
      });
      drain();
    });
}

export interface SelfValidateInput {
  index: number;
  // matchResult 는 Phase 3 의 self-validate 자체에는 더 이상 영향 안 줌 (마스터DB 와 독립).
  // 그러나 호출부 (photo-auto/route.ts) 가 이미 이 모양으로 inputs 를 만들고 있어 시그니처 유지.
  // 향후 Phase 4+ 에서 마스터 매칭 정보를 reduce 룰에 다시 끌어들일 가능성 대비.
  matchResult: unknown;
  ocrInsuranceCode: string;
  ocrProductName: string;
  ocrUnitPrice: number | null;
}

export interface SelfValidateMeta {
  runAt: string;
  model: string;
  attempted: number;
  succeeded: number;
  // 사후 디버깅용 — row 별 raw 양방향 답. GEMINI_SELFVALIDATE_DEBUG=true 일 때만 채움.
  rawAnswers?: Record<number, { byCode: DrugAnswer; byName: DrugAnswer }>;
}

export interface SelfValidateBatchResult {
  validations: Map<number, ValidationResult>;
  meta: SelfValidateMeta | null;
}

// 사진 한 장 분의 row 들을 한 번에 양방향 검증.
// Phase 3 — 마스터DB 매칭 여부와 무관하게 모든 행 검증 (사용자 명시 요구).
// 안전장치:
//   - ENV gate GEMINI_SELFVALIDATE_ENABLED 가 "true" 가 아니면 즉시 빈 결과.
//   - inputs.length > 100 이면 self-validate 자체 skip + 경고 로그 (kill switch).
//   - 각 row 호출 실패는 graceful — 그 row 는 마킹 안 됨, 다른 row 는 정상 진행.
export async function runSelfValidateBatch(
  inputs: SelfValidateInput[],
): Promise<SelfValidateBatchResult> {
  if (process.env.GEMINI_SELFVALIDATE_ENABLED !== "true") {
    return { validations: new Map(), meta: null };
  }
  if (inputs.length > ROW_KILL_SWITCH) {
    console.warn(`[self-validate] skip — row count ${inputs.length} > ${ROW_KILL_SWITCH}`);
    return { validations: new Map(), meta: null };
  }

  const debugMode = process.env.GEMINI_SELFVALIDATE_DEBUG === "true";
  const meta: SelfValidateMeta = {
    runAt: new Date().toISOString(),
    model: MODEL,
    attempted: inputs.length,
    succeeded: 0,
  };
  const validations = new Map<number, ValidationResult>();
  const rawAnswers: Record<number, { byCode: DrugAnswer; byName: DrugAnswer }> = {};
  if (inputs.length === 0) return { validations, meta };

  const limit = pLimit(2);   // prompt 가 길어진 만큼 동시성 1단 낮춤 (Pragmatist 권장)
  await Promise.all(
    inputs.map((t) =>
      limit(async () => {
        const { validation, raw } = await selfValidateDrug({
          insuranceCode: t.ocrInsuranceCode,
          productName: t.ocrProductName,
          unitPrice: t.ocrUnitPrice,
        });
        if (debugMode && raw) rawAnswers[t.index] = raw;
        if (validation && validation.mismatchFields.length > 0) {
          validations.set(t.index, validation);
          meta.succeeded++;
        }
      }),
    ),
  );

  if (debugMode && Object.keys(rawAnswers).length > 0) {
    meta.rawAnswers = rawAnswers;
  }
  return { validations, meta };
}
