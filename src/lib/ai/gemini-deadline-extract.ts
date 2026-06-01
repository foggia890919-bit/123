import { GoogleGenAI, Type } from "@google/genai";

export interface DeadlineRow {
  companyName: string;  // 제약사명 (raw, 정규화는 호출자에서)
  yearMonth: string;    // "YYYY-MM"
  deadline: string;     // ISO 날짜시간 (KST 가정)
  rawText: string;      // 모델이 인식한 원문 (검수용)
}

export interface DeadlineExtractResult {
  yearMonth: string;    // 이미지 전체 헤더의 적용월
  rows: DeadlineRow[];
}

const ROW_SCHEMA = {
  type: Type.OBJECT,
  required: ["companyName", "yearMonth", "deadline", "rawText"],
  properties: {
    companyName: { type: Type.STRING, description: "제약사명 (예: 대웅제약, 한미약품)" },
    yearMonth: { type: Type.STRING, description: "처방통계 해당월 'YYYY-MM' (예: 2026-05). 표 헤더의 적용월 또는 row별 표기 따라" },
    deadline: { type: Type.STRING, description: "제출 마감일시 'YYYY-MM-DD HH:mm' KST. 시간 없으면 23:59" },
    rawText: { type: Type.STRING, description: "셀에 적힌 원문 그대로 (예: '5/15까지', '5월 15일 18시')" },
  },
};

const RESULT_SCHEMA = {
  type: Type.OBJECT,
  required: ["yearMonth", "rows"],
  properties: {
    yearMonth: { type: Type.STRING, description: "이미지 전체 헤더에 적힌 적용월 'YYYY-MM'. 없으면 첫 row의 yearMonth" },
    rows: { type: Type.ARRAY, items: ROW_SCHEMA },
  },
};

const PROMPT = `이 이미지는 제약사별 통계 제출 마감일 안내표입니다.

각 행에서 다음을 추출:
- 제약사명 (companyName)
- 처방통계 해당월 (yearMonth, "YYYY-MM" 형식)
- 제출 마감일시 (deadline, "YYYY-MM-DD HH:mm" KST)
- 원문 (rawText)

규칙:
- "5/15"는 현재 년도 5월 15일로 해석
- 시간 없으면 23:59 적용
- 마감월(yearMonth)이 표시 안 됐으면 헤더의 적용월을 모든 행에 동일 적용
- 같은 제약사가 여러 번 나오면 각각 row로 추출`;

export async function extractDeadlinesFromImage(
  imageBase64: string,
  mimeType: string = "image/jpeg",
): Promise<DeadlineExtractResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: PROMPT },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RESULT_SCHEMA,
      temperature: 0,
    },
  });

  const text = response.text ?? "";
  try {
    const parsed = JSON.parse(text) as DeadlineExtractResult;
    return {
      yearMonth: parsed.yearMonth ?? "",
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
    };
  } catch {
    return { yearMonth: "", rows: [] };
  }
}
