import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    const rawUrl = process.env.CLOVA_OCR_INVOKE_URL?.trim();
    // Vercel은 http:// 아웃바운드를 차단하므로 https:// 로 강제 변환
    const clovaUrl = rawUrl?.replace(/^http:\/\//, "https://");
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

    let clovaRes: Response;
    try {
      clovaRes = await fetch(clovaUrl, {
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
    } catch (fetchErr) {
      return NextResponse.json({ error: `CLOVA 연결 실패: ${String(fetchErr)}. URL을 확인하세요.` }, { status: 500 });
    }

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

  // 폼에서 이미 처방년월/병원/제약사를 받으므로 OCR은 약품만 추출
  const drugs = extractDrugs(lines, fields, avgConf);

  return {
    source: "clova",
    hospitalName: { value: "", confidence: 0 },
    institutionCode: { value: "", confidence: 0 },
    prescriptionDate: { value: "", confidence: 0 },
    patientName: { value: "", confidence: 0 },
    drugs,
    avgConfidence: avgConf,
    rawText: fullText,
  };
}

// UI 헤더/라벨/합계 등 약품이 아닌 라인
const HEADER_WORDS = [
  "처방", "의약품", "약품명", "약품코드", "보험코드", "청구코드", "사용자코드",
  "수가코드", "코드명", "명령", "명칭", "단위", "수량", "단가", "금액", "총금액",
  "총수량", "총사용량", "총투여량", "내원구분", "급여구분", "급비구분", "원내", "원외",
  "제약회사", "제약사", "진료과", "진료실", "합계", "소계", "총계", "작업일자",
  "검색기간", "검색조건", "처방일자", "환자명", "환자번호", "성명", "성별", "나이",
  "통계", "항목", "필드", "드래그", "그룹", "기준", "약제", "약국자료", "원무자료",
];

// 약품명: 의미있는 한글 약품명 + 제형 힌트(정/캡슐/시럽 등) 또는 영숫자 조합
// 순수 영문 코드(pregaba75) 약품도 허용
// 보험코드: 9자리 숫자 또는 영문 대문자 + 숫자
const CODE_NUM_RE = /\b(\d{9})\b/;
const CODE_ALNUM_RE = /\b([A-Z][A-Z0-9]{5,})\b/;

// 약품명: 한글+제형 패턴. 단, (주) 앞의 주는 제형이 아님
// "(주)" = 주식회사 약어이므로 "X(주" 또는 "X주)" 패턴이면 제외
const DRUG_FORM = "(?:정제|캅셀|캡슐|시럽|주사액|주사|연고|크림|겔|패취|포|산제|환제|정|액|주)";
const DRUG_NAME_RE = new RegExp(
  `([가-힣A-Za-z][가-힣A-Za-z0-9./()\\s-]{2,}?${DRUG_FORM})(?!\\))`
);
const DRUG_NAME_EN_RE = /\b([A-Z][A-Za-z0-9]{4,})\b/;

// 제약회사명 패턴 (약품명으로 오인 방지)
const COMPANY_RE = /[가-힣]+(?:제약|바이오|파마|팜|헬스케어|케미칼|사이언스|신약|약품|생명|의약)/;

function isHeaderLine(text: string): boolean {
  const stripped = text.trim();
  if (stripped.length < 3) return true;
  for (const w of HEADER_WORDS) {
    if (stripped === w || stripped.startsWith(w + " ") || stripped.endsWith(" " + w)) return true;
  }
  if (!/\d/.test(stripped)) return true;
  return false;
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

  const numRe = /[\d,]+(?:\.\d+)?/g;

  for (const line of lines) {
    const text = line.text.trim();
    if (isHeaderLine(text)) continue;

    // ── 코드 추출 ──────────────────────────────────────────
    const codeNumMatch = text.match(CODE_NUM_RE);
    const codeAlnumMatch = text.match(CODE_ALNUM_RE);
    const code = codeNumMatch?.[1] ?? codeAlnumMatch?.[1] ?? "";

    // ── 약품명 추출 ────────────────────────────────────────
    // 9자리 코드가 있으면 코드 뒤 텍스트에서 약품명 탐색 (제약사명은 코드 앞에 있음)
    let searchText = text;
    if (codeNumMatch) {
      const codeIdx = text.indexOf(codeNumMatch[1]);
      searchText = text.slice(codeIdx + codeNumMatch[1].length);
    }

    const nameKoMatch = searchText.match(DRUG_NAME_RE);
    const nameEnMatch = searchText.match(DRUG_NAME_EN_RE);
    let name = "";
    if (nameKoMatch) {
      name = nameKoMatch[1].trim();
      // 제약회사명이 약품명으로 잡힌 경우 제거
      if (COMPANY_RE.test(name)) name = "";
    }
    if (!name && nameEnMatch && !codeAlnumMatch) name = nameEnMatch[1].trim();

    // 약품명 또는 코드 중 하나는 필수
    if (!name && !code) continue;

    // ── 숫자 필드 추출 (9자리 보험코드 제외) ──────────────
    const allNums = (text.match(numRe) || []).filter((n) => {
      const digits = n.replace(/[,.]/g, "");
      return digits.length !== 9; // 보험코드(9자리)는 금액/수량에서 제외
    });

    if (allNums.length < 1) continue;

    const numericValues = allNums
      .map((n) => ({ raw: n, num: parseFloat(n.replace(/,/g, "")) }))
      .filter((x) => !isNaN(x.num) && x.num > 0);

    numericValues.sort((a, b) => b.num - a.num);
    // 가장 큰 값=총금액, 가장 작은 값=수량(투여량)
    const price = numericValues[0]?.raw?.replace(/,/g, "") ?? "";
    const quantity = numericValues[numericValues.length - 1]?.raw ?? "";

    if (name && name.length < 2) continue;

    drugs.push({
      name: { value: name, confidence: name ? (confForToken(name, fields) || line.conf || avgConf) : 0 },
      code: { value: code, confidence: code ? (confForToken(code, fields) || line.conf || avgConf) : 0 },
      quantity: { value: quantity, confidence: quantity ? (confForToken(quantity, fields) || line.conf) : 0 },
      price: { value: price, confidence: price ? (confForToken(price, fields) || line.conf) : 0 },
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
