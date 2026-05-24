import { GoogleGenAI, Type } from "@google/genai";
import type { MatchResult, ValidationResult } from "./medication-master-match";

// Gemini 자가검증 — Vision OCR 1차 결과를 텍스트 API 로 cross-check.
// 보험코드 ↔ 약품명 ↔ 약가 가 Gemini 자체 지식과 맞는지 확인 후
// 불일치 row 를 "검증대상" 으로 마킹. UI 에서 사람이 한 번 더 확인.
//
// 핵심 안전장치:
// 1. 마스터DB 가 잡은 row (matchedMedicationId !== null) 는 skip — 결정론적 매칭이 우선
// 2. ENV gate 기본 false — 켜야 동작 (비용 가시화)
// 3. graceful — timeout/예외/JSON 파싱 실패 시 null, OCR row 자체는 죽지 않음
// 4. 인라인 동시성 제한 (p-limit 의존 회피)

const MODEL = "gemini-3.5-flash";
const TIMEOUT_MS = 8000;

interface SelfValidatePayload {
  insuranceCode: string;
  productName: string;
  unitPrice: number | null;
}

const SCHEMA = {
  type: Type.OBJECT,
  required: ["productNameSuggest", "insuranceCodeSuggest", "unitPriceSuggest", "mismatchFields"],
  properties: {
    productNameSuggest: {
      type: Type.STRING,
      description: "보험코드 또는 약품명을 보고 너의 자체 지식으로 알아낸 정식 약품명. 모르면 빈 문자열.",
    },
    insuranceCodeSuggest: {
      type: Type.STRING,
      description: "이 약품에 해당한다고 아는 한국 EDI 보험코드 9자리 숫자. 모르면 빈 문자열.",
    },
    unitPriceSuggest: {
      type: Type.NUMBER,
      description: "이 약품의 약가(원). 모르면 0.",
    },
    mismatchFields: {
      type: Type.ARRAY,
      description: "OCR 결과와 너의 답이 명백히 다른 필드 이름. productName, insuranceCode, unitPrice 중 해당하는 것만.",
      items: { type: Type.STRING },
    },
  },
};

function buildPrompt(p: SelfValidatePayload): string {
  return [
    "다음은 한국 EMR 처방통계 사진에서 Gemini Vision OCR 로 추출한 약품 한 행이다.",
    "너의 자체 의약품 지식만 사용해서 검증해라. 추측 환각 금지.",
    "",
    "OCR 결과:",
    `- 보험코드(EDI 9자리): ${p.insuranceCode || "(없음)"}`,
    `- 약품명: ${p.productName || "(없음)"}`,
    `- 단가(원): ${p.unitPrice ?? "(모름)"}`,
    "",
    "응답 필드:",
    "- productNameSuggest: 위 보험코드 또는 약품명에 해당하는 정식 약품명. 확신 없으면 빈 문자열.",
    "- insuranceCodeSuggest: 위 약품에 해당하는 EDI 보험코드 9자리. 확신 없으면 빈 문자열.",
    "- unitPriceSuggest: 약가(원). 확신 없으면 0.",
    "- mismatchFields: OCR 값과 너의 답이 명백히 다른 필드만. 예: ['productName'].",
    "",
    "주의: 정말 알고 있는 약품만 답해. 모르면 비우고 mismatchFields 도 비워라.",
  ].join("\n");
}

async function callGemini(payload: SelfValidatePayload): Promise<ValidationResult | null> {
  if (!process.env.GEMINI_API_KEY) return null;
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
  const raw = response.text ?? "";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const productNameSuggest = String(parsed.productNameSuggest ?? "").trim();
  const insuranceCodeSuggest = String(parsed.insuranceCodeSuggest ?? "").replace(/\D/g, "");
  const unitPriceRaw = Number(parsed.unitPriceSuggest ?? 0);
  const unitPriceSuggest = Number.isFinite(unitPriceRaw) ? unitPriceRaw : 0;
  const mismatchRaw = Array.isArray(parsed.mismatchFields) ? parsed.mismatchFields : [];
  const mismatchFields = mismatchRaw
    .map((x) => String(x).trim())
    .filter((x): x is "productName" | "insuranceCode" | "unitPrice" =>
      x === "productName" || x === "insuranceCode" || x === "unitPrice");

  // Gemini 가 빈손이면 검증 의미 없음 — 마킹하지 않음
  if (!productNameSuggest && !insuranceCodeSuggest && unitPriceSuggest === 0) return null;

  return {
    source: "gemini-self",
    mismatchFields,
    suggestion: {
      ...(productNameSuggest ? { productName: productNameSuggest } : {}),
      ...(insuranceCodeSuggest ? { insuranceCode: insuranceCodeSuggest } : {}),
      ...(unitPriceSuggest > 0 ? { unitPrice: unitPriceSuggest } : {}),
    },
  };
}

export async function selfValidateDrug(payload: SelfValidatePayload): Promise<ValidationResult | null> {
  try {
    return await Promise.race([
      callGemini(payload),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

// p-limit 의존성 회피용 인라인 동시성 제한기 — 한 사진의 row 들을 N 개씩만 동시 호출.
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
  matchResult: MatchResult;
  ocrUnitPrice: number | null;
}

export interface SelfValidateMeta {
  runAt: string;
  model: string;
  attempted: number;
  succeeded: number;
}

export interface SelfValidateBatchResult {
  validations: Map<number, ValidationResult>;
  meta: SelfValidateMeta | null;
}

// 사진 한 장 분의 row 들을 한 번에 검증. ENV gate 가 꺼져있으면 즉시 빈 결과.
// skip 조건: matchedMedicationId !== null (마스터DB 가 잡은 row 는 결정론적 결과를 신뢰)
//   - 자동 흡수: Case B (nameAutoReplaced=true) 도 matchedMedicationId 가 있어서 skip
//   - matchConfidence === 100 / 95 / 70 모두 skip — Skeptic 우려(순환 검증) 흡수
export async function runSelfValidateBatch(
  inputs: SelfValidateInput[],
): Promise<SelfValidateBatchResult> {
  if (process.env.GEMINI_SELFVALIDATE_ENABLED !== "true") {
    return { validations: new Map(), meta: null };
  }

  const targets = inputs.filter((x) => x.matchResult.matchedMedicationId === null);
  const meta: SelfValidateMeta = {
    runAt: new Date().toISOString(),
    model: MODEL,
    attempted: targets.length,
    succeeded: 0,
  };
  const validations = new Map<number, ValidationResult>();
  if (targets.length === 0) return { validations, meta };

  const limit = pLimit(3);
  await Promise.all(
    targets.map((t) =>
      limit(async () => {
        const v = await selfValidateDrug({
          insuranceCode: t.matchResult.insuranceCode,
          productName: t.matchResult.productName,
          unitPrice: t.ocrUnitPrice,
        });
        if (v && v.mismatchFields.length > 0) {
          validations.set(t.index, v);
          meta.succeeded++;
        }
      }),
    ),
  );
  return { validations, meta };
}
