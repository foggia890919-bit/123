import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireRole, isNextResponse } from "@/lib/auth-guard";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

이 약품의 한국 ${topic} 상병코드(KCD/ICD-10) 상위 5개를 알려주세요.
다음 JSON 배열 형식만 응답하세요 (다른 텍스트 없이):

[
  { "code": "K21.0", "name": "위식도역류병", "ratio": 23.5 },
  ...
]

- code: KCD 코드 (예: K21.0)
- name: 상병명 (한글)
- ratio: 전체 처방 중 비율(%) — 합계가 100 이하
- 비율 높은 순 정렬
- 실제 한국 처방 데이터 기반으로 합리적으로 추정`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("JSON 파싱 실패");

    const results: IcdResult[] = JSON.parse(jsonMatch[0]);
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
