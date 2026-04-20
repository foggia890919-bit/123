import { NextRequest, NextResponse } from "next/server";

interface ClovaField {
  inferText: string;
  inferConfidence: number;
  lineBreak?: boolean;
  boundingPoly?: { vertices: { x: number; y: number }[] };
}

export async function GET() {
  // 환경변수 진단용 (값은 노출하지 않고 존재 여부와 길이만)
  const url = process.env.CLOVA_OCR_INVOKE_URL ?? "";
  const secret = process.env.CLOVA_OCR_SECRET_KEY ?? "";
  return NextResponse.json({
    hasUrl: !!url,
    urlLength: url.length,
    urlStartsWith: url.slice(0, 20),
    hasSecret: !!secret,
    secretLength: secret.length,
    runtime: process.env.VERCEL ? "vercel" : "local",
  });
}

export async function POST(req: NextRequest) {
  try {
    const clovaUrl = process.env.CLOVA_OCR_INVOKE_URL?.trim();
    const clovaSecret = process.env.CLOVA_OCR_SECRET_KEY?.trim();
    if (!clovaUrl && !clovaSecret) {
      return NextResponse.json({ error: "CLOVA_OCR_INVOKE_URL 과 CLOVA_OCR_SECRET_KEY 둘 다 설정되지 않았습니다. Vercel → Settings → Environment Variables 에 추가 후 Redeploy 하세요." }, { status: 500 });
    }
    if (!clovaUrl) {
      return NextResponse.json({ error: "CLOVA_OCR_INVOKE_URL 이 설정되지 않았습니다." }, { status: 500 });
    }
    if (!clovaSecret) {
      return NextResponse.json({ error: "CLOVA_OCR_SECRET_KEY 가 설정되지 않았습니다." }, { status: 500 });
    }

    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    if (!file) return NextResponse.json({ error: "이미지가 없습니다" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const format = ["png", "gif", "bmp", "tiff"].includes(ext) ? ext : "jpg";

    const clovaRes = await fetch(clovaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-OCR-SECRET": clovaSecret },
      body: JSON.stringify({
        version: "V2",
        requestId: crypto.randomUUID(),
        timestamp: Date.now(),
        lang: "ko",
        images: [{ format, name: "prescription", data: base64 }],
      }),
    });

    if (!clovaRes.ok) {
      const errText = await clovaRes.text();
      return NextResponse.json({ error: `CLOVA 오류 (${clovaRes.status}): ${errText}` }, { status: 500 });
    }

    const clovaData = await clovaRes.json();
    const image = clovaData.images?.[0];
    if (!image || image.inferResult !== "SUCCESS") {
      return NextResponse.json({ error: "OCR 인식 실패: " + (image?.message ?? "알 수 없는 오류") }, { status: 500 });
    }

    const fields: ClovaField[] = image.fields || [];
    const result = parsePrescription(fields);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── 파싱 ──────────────────────────────────────────────────────────────────────

function buildLines(fields: ClovaField[]): { text: string; conf: number }[] {
  const lines: { text: string; conf: number }[] = [];
  let cur = { text: "", conf: 0, count: 0 };
  for (const f of fields) {
    cur.text += (cur.text ? " " : "") + f.inferText;
    cur.conf += f.inferConfidence;
    cur.count++;
    if (f.lineBreak !== false) {
      lines.push({ text: cur.text.trim(), conf: cur.count ? Math.round((cur.conf / cur.count) * 100) : 0 });
      cur = { text: "", conf: 0, count: 0 };
    }
  }
  if (cur.text) lines.push({ text: cur.text.trim(), conf: cur.count ? Math.round((cur.conf / cur.count) * 100) : 0 });
  return lines;
}

function confForToken(token: string, fields: ClovaField[]): number {
  const t = token.replace(/\s+/g, "").toLowerCase();
  for (const f of fields) {
    if (f.inferText.replace(/\s+/g, "").toLowerCase().includes(t)) {
      return Math.round(f.inferConfidence * 100);
    }
  }
  return 0;
}

function parsePrescription(fields: ClovaField[]) {
  const lines = buildLines(fields);
  const fullText = lines.map((l) => l.text).join("\n");
  const avgConf = fields.length
    ? Math.round(fields.reduce((s, f) => s + f.inferConfidence * 100, 0) / fields.length)
    : 0;

  // 병원명
  const hospitalRe = /([가-힣a-zA-Z0-9\s]{2,20}(?:의원|병원|클리닉|의료원|한의원|요양병원|치과|내과|외과|소아과|산부인과|안과|이비인후과|피부과|정형외과|신경과|정신건강의학과))/;
  const hospitalMatch = fullText.match(hospitalRe);
  const hospitalVal = hospitalMatch?.[1]?.trim() ?? "";
  const hospitalConf = hospitalVal ? (confForToken(hospitalVal, fields) || avgConf) : 0;

  // 요양기관번호
  const instRe = /(?:요양기관(?:기호|번호)|기관기호|기관번호)[^\d]*(\d{8,10})/;
  const instMatch = fullText.match(instRe);
  const instVal = instMatch?.[1] ?? "";
  const instConf = instVal ? (confForToken(instVal, fields) || avgConf) : 0;

  // 처방일
  const dateRe = /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/g;
  let dateMatch: RegExpExecArray | null;
  let prescDate = "";
  let dateConf = 0;
  while ((dateMatch = dateRe.exec(fullText)) !== null) {
    const y = parseInt(dateMatch[1]);
    if (y >= 2000 && y <= 2100) {
      prescDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
      dateConf = confForToken(dateMatch[0], fields) || avgConf;
      break;
    }
  }

  // 환자명
  const patientRe = /(?:성명|환자명|환자)[:\s]*([가-힣]{2,5})/;
  const patientMatch = fullText.match(patientRe);
  const patientVal = patientMatch?.[1]?.trim() ?? "";
  const patientConf = patientVal ? (confForToken(patientVal, fields) || avgConf) : 0;

  // 약품 추출
  const drugs = extractDrugs(lines, fields, avgConf);

  return {
    source: "clova",
    hospitalName: { value: hospitalVal, confidence: hospitalConf },
    institutionCode: { value: instVal, confidence: instConf },
    prescriptionDate: { value: prescDate, confidence: dateConf },
    patientName: { value: patientVal, confidence: patientConf },
    drugs,
    avgConfidence: avgConf,
    rawText: fullText,
  };
}

function extractDrugs(
  lines: { text: string; conf: number }[],
  fields: ClovaField[],
  avgConf: number
) {
  const drugs: {
    name: { value: string; confidence: number };
    code: { value: string; confidence: number };
    quantity: { value: string; confidence: number };
    price: { value: string; confidence: number };
  }[] = [];

  // 의약품 라인 감지: 한글 약품명(정/캡슐/주/액 포함 가능) + 숫자들
  const drugLineRe = /[가-힣]{2,}(?:\s*[a-zA-Z0-9]+)?(?:\s*(?:정|캡슐|주사|주|액|시럽|크림|연고))?/;
  const codeRe = /\b(\d{9})\b/; // 보험코드 9자리
  const qtyRe = /(\d+(?:\.\d+)?)\s*(?:정|캡슐|개|일)/;
  const priceRe = /(\d[\d,]+)\s*원?/;

  for (const line of lines) {
    if (!drugLineRe.test(line.text)) continue;
    // 너무 짧거나 헤더성 텍스트 제외
    if (line.text.length < 4) continue;
    if (/처방|의약품|약품명|코드|수량|단가|금액/.test(line.text)) continue;

    const nameMatch = line.text.match(drugLineRe);
    if (!nameMatch) continue;
    const name = nameMatch[0].trim();
    if (name.length < 2) continue;

    const codeMatch = line.text.match(codeRe);
    const qtyMatch = line.text.match(qtyRe);
    const priceMatch = line.text.match(priceRe);

    drugs.push({
      name: { value: name, confidence: confForToken(name, fields) || line.conf || avgConf },
      code: { value: codeMatch?.[1] ?? "", confidence: codeMatch ? (confForToken(codeMatch[1], fields) || line.conf) : 50 },
      quantity: { value: qtyMatch?.[1] ?? "", confidence: qtyMatch ? (confForToken(qtyMatch[1], fields) || line.conf) : 55 },
      price: { value: priceMatch?.[1]?.replace(/,/g, "") ?? "", confidence: priceMatch ? (confForToken(priceMatch[1], fields) || line.conf) : 50 },
    });
  }

  if (drugs.length === 0) {
    drugs.push({
      name: { value: "", confidence: 0 },
      code: { value: "", confidence: 0 },
      quantity: { value: "", confidence: 0 },
      price: { value: "", confidence: 0 },
    });
  }

  return drugs;
}
