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

// 2026-05 GA. 단일 모델 — Pro 폴백 불필요 (3.5 Flash 가 3.1 Pro 보다 우위).
export type GeminiSalesModel = "gemini-3.5-flash";

const DEFAULT_MODEL: GeminiSalesModel = "gemini-3.5-flash";

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

// 완전 빈손 판정. API route 의 422 응답 분기에 사용.
export function isSalesExtractEmpty(d: SalesExtractResult): boolean {
  return !d.hospitalName && d.totalAmount === 0;
}
