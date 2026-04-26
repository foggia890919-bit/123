import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { requireRole, isNextResponse } from "@/lib/auth-guard";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

export interface IcdResult {
  code: string;
  name: string;
  ratio: number;
}

export async function POST(req: NextRequest) {
  const guard = await requireRole("SALES_REP");
  if (isNextResponse(guard)) return guard;

  const { productName, ingredientName, type } = await req.json();
  if (!productName || !type) {
    return NextResponse.json({ error: "필수 파라미터 누락" }, { status: 400 });
  }

  const isFrequent = type === "frequent";
  const topic = isFrequent
    ? "다빈도 처방(단독 처방)"
    : "병용처방";

  const prompt = `당신은 한국 의약품 처방 패턴 전문가입니다.

약품명: ${productName}${ingredientName ? `\n성분명: ${ingredientName}` : ""}

이 약품의 한국 ${topic} 상병코드(KCD/ICD-10) 상위 5개를 추정해주세요.

엄격한 규칙:
- 약품의 적응증과 직접 연관된 상병코드만 답변 (간접 동반질환은 제외)
- 비율(ratio)은 정확한 통계가 없으면 0~100 사이 임의 추정값 — 5단위/10단위로 떨어지는 값은 금지
- 정확한 데이터 출처가 없으면 results 를 빈 배열 [] 로 반환
- 환자 동반질환(예: 고지혈증약에 당뇨병, 고혈압) 같이 약품 자체의 직접 적응증이 아닌 코드는 제외

응답은 다음 JSON 객체 형식 (배열은 results 안에):
{
  "results": [
    { "code": "K21.0", "name": "위식도역류병", "ratio": 23.5 },
    ...
  ]
}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text ?? "";
    if (!text) throw new Error("AI 응답 없음");

    // Parse flexibly — direct array, {results:[...]}, or any object with first array value
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\[[\s\S]*\]/);
      if (!m) throw new Error(`JSON 파싱 실패 — 응답: ${text.slice(0, 200)}`);
      parsed = JSON.parse(m[0]);
    }

    let arr: unknown;
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      arr = Array.isArray(obj.results) ? obj.results : Object.values(obj).find((v) => Array.isArray(v));
    }
    if (!Array.isArray(arr)) {
      throw new Error(`응답에 배열 없음 — ${text.slice(0, 200)}`);
    }

    const results = arr as IcdResult[];
    const top5 = results.slice(0, 5).map((r) => ({
      code: String(r.code),
      name: String(r.name),
      ratio: Number(r.ratio),
    }));

    return NextResponse.json({ results: top5, type });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
