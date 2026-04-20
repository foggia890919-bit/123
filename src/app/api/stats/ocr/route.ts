import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    if (!file) return NextResponse.json({ error: "이미지가 없습니다" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mediaType = (file.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp") || "image/jpeg";

    const prompt = `이 처방전 이미지를 분석하여 다음 JSON 형식으로 정확히 응답하세요. confidence는 0~100 사이 정수로 인식 신뢰도를 나타냅니다.

{
  "hospitalName": { "value": "병원명", "confidence": 95 },
  "institutionCode": { "value": "요양기관번호", "confidence": 90 },
  "prescriptionDate": { "value": "YYYY-MM-DD", "confidence": 85 },
  "patientName": { "value": "환자명", "confidence": 80 },
  "drugs": [
    {
      "name": { "value": "약품명", "confidence": 90 },
      "code": { "value": "약품코드 또는 보험코드", "confidence": 75 },
      "quantity": { "value": "수량(숫자)", "confidence": 85 },
      "price": { "value": "단가(숫자, 원단위)", "confidence": 70 }
    }
  ]
}

처방전에서 읽을 수 없거나 불명확한 항목은 value를 빈 문자열로, confidence를 낮게 설정하세요.
JSON 외 다른 텍스트는 출력하지 마세요.`;

    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ error: "OCR 파싱 실패" }, { status: 500 });

    const ocr = JSON.parse(jsonMatch[0]);

    const allConfidences: number[] = [
      ocr.hospitalName?.confidence ?? 0,
      ocr.institutionCode?.confidence ?? 0,
      ocr.prescriptionDate?.confidence ?? 0,
      ocr.patientName?.confidence ?? 0,
      ...(ocr.drugs ?? []).flatMap((d: { name?: { confidence: number }; code?: { confidence: number }; quantity?: { confidence: number }; price?: { confidence: number } }) => [
        d.name?.confidence ?? 0,
        d.code?.confidence ?? 0,
        d.quantity?.confidence ?? 0,
        d.price?.confidence ?? 0,
      ]),
    ];
    const avgConfidence = allConfidences.length
      ? Math.round(allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length)
      : 0;

    return NextResponse.json({ ...ocr, avgConfidence });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
