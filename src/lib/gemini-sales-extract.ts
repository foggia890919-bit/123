import { GoogleGenAI, Type } from "@google/genai";

export interface SalesExtractResult {
  hospitalName: string;
  salesDate: string;     // "YYYY-MM-DD"
  totalAmount: number;   // 정수 원 단위
  salesRep: string;      // 없으면 ""
}

export interface SalesExtractDebug {
  rawText: string;
  model: string;
  durationMs: number;
}

export type GeminiSalesModel = "gemini-2.5-flash" | "gemini-2.5-pro";

const DEFAULT_MODEL: GeminiSalesModel = "gemini-2.5-flash";
const FALLBACK_MODEL: GeminiSalesModel = "gemini-2.5-pro";

const SALES_SCHEMA = {
  type: Type.OBJECT,
  required: ["hospital_name", "sales_date", "total_amount", "sales_rep"],
  properties: {
    hospital_name: {
      type: Type.STRING,
      description: "병원·의원·약국 이름. 예: '강남세란의원'. 모르면 빈 문자열.",
    },
    sales_date: {
      type: Type.STRING,
      description:
        "실적 작성일 또는 마감일을 YYYY-MM-DD 포맷으로. 월/일만 있고 연도 없으면 올해로. 모르면 빈 문자열.",
    },
    total_amount: {
      type: Type.INTEGER,
      description: "총 실적·매출 금액(원). 콤마와 '원' 제거한 순수 정수. 모르면 0.",
    },
    sales_rep: {
      type: Type.STRING,
      description: "영업사원·담당자 이름. 없거나 모르면 빈 문자열.",
    },
  },
};

function buildPrompt(): string {
  const yyyy = new Date().getFullYear();
  return [
    "이 사진은 영업사원이 카카오톡으로 보낸 병원 실적 증빙(영수증/실적표/매출장부) 입니다.",
    "다음 4개 필드를 정확히 추출하세요. 추측 금지. 모호하면 빈 문자열 또는 0.",
    "",
    "- hospital_name: 병원·의원·약국 이름 (예: '서울연세안과').",
    `- sales_date: 실적 작성일 또는 마감일. YYYY-MM-DD. 월/일만 있고 연도 누락이면 ${yyyy} 로 보정.`,
    "- total_amount: 합계/총액/실적 금액. 콤마·'원' 제거한 순수 정수.",
    "- sales_rep: 영업사원·담당자 이름. 없으면 빈 문자열.",
    "",
    "응답은 지정된 JSON 스키마만. 자유 텍스트 금지.",
  ].join("\n");
}

function parseJsonLoose(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fallthrough */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function toInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === "string") {
    const n = parseInt(v.replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

export async function extractSalesFromImage(
  base64: string,
  mimeType: string,
  model: GeminiSalesModel = DEFAULT_MODEL,
): Promise<{ data: SalesExtractResult; debug: SalesExtractDebug }> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY 미설정");
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const t0 = Date.now();
  const response = await ai.models.generateContent({
    model,
    // 사진 원본 그대로 전송 — OCR 사전 처리 없음. Gemini 멀티모달이 직접 본다.
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: buildPrompt() },
      ],
    }],
    config: {
      responseMimeType: "application/json",
      responseSchema: SALES_SCHEMA,
      temperature: 0,
    },
  });

  const raw = response.text ?? "";
  const parsed = parseJsonLoose(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Gemini 빈/잘못된 응답: ${raw.slice(0, 200)}`);
  }

  const data: SalesExtractResult = {
    hospitalName: String(parsed.hospital_name ?? "").trim(),
    salesDate: String(parsed.sales_date ?? "").trim(),
    totalAmount: toInt(parsed.total_amount),
    salesRep: String(parsed.sales_rep ?? "").trim(),
  };

  return {
    data,
    debug: { rawText: raw, model, durationMs: Date.now() - t0 },
  };
}

// "빈손" 정의: 병원명과 금액 둘 다 비어있으면 사실상 인식 실패.
// 둘 중 하나라도 있으면 사용자가 검수해서 쓸 수 있으니 폴백 안 함.
function isExtractionEmpty(d: SalesExtractResult): boolean {
  return !d.hospitalName && d.totalAmount === 0;
}

// Flash 로 먼저 시도 → 빈손이면 Pro 로 자동 재시도.
// 비정형/흐릿한 사진에서 Flash 가 놓치는 케이스를 Pro 의 더 강한 vision 으로 회수.
// debug.model 에 최종 사용된 모델이 기록되므로 운영자가 어떤 사진이 Pro 까지 갔는지 추적 가능.
export async function extractSalesWithFallback(
  base64: string,
  mimeType: string,
): Promise<{
  data: SalesExtractResult;
  debug: SalesExtractDebug & { fallbackUsed: boolean; flashDurationMs?: number };
}> {
  const first = await extractSalesFromImage(base64, mimeType, DEFAULT_MODEL);
  if (!isExtractionEmpty(first.data)) {
    return { data: first.data, debug: { ...first.debug, fallbackUsed: false } };
  }

  // Flash 가 빈손 → Pro 재시도
  let second: { data: SalesExtractResult; debug: SalesExtractDebug };
  try {
    second = await extractSalesFromImage(base64, mimeType, FALLBACK_MODEL);
  } catch {
    // Pro 호출 자체가 실패하면 Flash 결과(빈손) 반환 — 사용자에게는 422 로 전달됨
    return {
      data: first.data,
      debug: { ...first.debug, fallbackUsed: false, flashDurationMs: first.debug.durationMs },
    };
  }
  return {
    data: second.data,
    debug: {
      rawText: second.debug.rawText,
      model: second.debug.model,
      durationMs: second.debug.durationMs,
      fallbackUsed: true,
      flashDurationMs: first.debug.durationMs,
    },
  };
}
