import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAdmin, isNextResponse } from "@/lib/auth-guard";

export const runtime = "nodejs";
export const maxDuration = 90;

// ── 응답 타입 ─────────────────────────────────────────────────────────────────

interface Field {
  value: string;
  confidence: number; // 0-100
}

export interface FusionDrug {
  insuranceCode: Field;
  companyName: Field;
  productName: Field;
  quantity: Field;
  unitPrice: number | null;          // 마스터 DB 단가 (합계 계산용, UI 비표시)
  matchedMedicationId: string | null;
  finalConfidence: number;            // 최종 신뢰도 0-100
  manualCheck: boolean;               // < 95 이면 true
  bboxYPercent: number | null;        // 이미지 내 행의 Y 중심 (0~100), 없으면 null
}

export interface FusionResult {
  source: "fusion";
  drugs: FusionDrug[];
  avgConfidence: number;
  manualCheckCount: number;
  rawClovaText: string;
  rawGeminiText: string;
  hospitalName: Field;
  // legacy placeholders (UI/DB 호환)
  institutionCode: Field;
  prescriptionDate: Field;
  patientName: Field;
}

// ── 진단용 GET ────────────────────────────────────────────────────────────────

export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  return NextResponse.json({
    hasClovaUrl: !!process.env.CLOVA_OCR_INVOKE_URL,
    hasClovaSecret: !!process.env.CLOVA_OCR_SECRET_KEY,
    hasGemini: !!process.env.GEMINI_API_KEY,
  });
}

// ── 메인 POST ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  try {
    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    if (!file) return NextResponse.json({ error: "이미지가 없습니다" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const mimeType =
      ext === "png" ? "image/png" :
      ext === "gif" ? "image/gif" :
      ext === "bmp" ? "image/bmp" :
      ext === "tiff" ? "image/tiff" :
      "image/jpeg";

    // ── 1단계: Clova + Gemini Vision 병렬 OCR ─────────────────────────────
    const [clovaOut, geminiOut] = await Promise.allSettled([
      callClovaOcr(base64, ext),
      callGeminiVision(base64, mimeType),
    ]);

    const clovaResult = clovaOut.status === "fulfilled" ? clovaOut.value : null;
    const clovaText = clovaResult?.text ?? "";
    const clovaFields = clovaResult?.fields ?? [];
    const clovaImageHeight = clovaResult?.imageHeight ?? 0;
    const geminiDraft = geminiOut.status === "fulfilled" ? geminiOut.value : null;
    const geminiText = geminiDraft ? JSON.stringify(geminiDraft, null, 2) : "";

    if (!clovaText && !geminiDraft) {
      const errs = [
        clovaOut.status === "rejected" ? `Clova: ${clovaOut.reason}` : "",
        geminiOut.status === "rejected" ? `Gemini: ${geminiOut.reason}` : "",
      ].filter(Boolean).join(" | ");
      return NextResponse.json({ error: `OCR 양쪽 모두 실패: ${errs}` }, { status: 500 });
    }

    // ── 2단계: 9자리 보험코드 후보로 마스터 DB 사전 조회 ───────────────────
    const candidateCodes = extractInsuranceCodes(clovaText, geminiDraft);
    const masterByCode = await fetchMasterByCodes(candidateCodes);

    // ── 3단계: LLM 병합/검증 — Vision 결과의 모든 코드가 마스터와 일치하면 스킵 ─
    const visionDrugs = geminiDraft?.drugs ?? [];
    const visionAllMatched = visionDrugs.length > 0 && visionDrugs.every((d) => {
      const c = d.insuranceCode.replace(/\D/g, "");
      return c.length === 9 && masterByCode.has(c);
    });
    const merged: MergedDrug[] = visionAllMatched
      ? visionDrugs.map((d) => ({ ...d, confidence: Math.max(d.confidence, 95) }))
      : await callGeminiMerge({
          clovaText,
          geminiDraft,
          masterCandidates: Array.from(masterByCode.values()).map((m) => ({
            insuranceCode: m.insuranceCode,
            productName: m.productName,
            companyName: m.companyName,
          })),
        });

    // ── 4단계: 약품마다 마스터 매칭 + 신뢰도 계산 ──────────────────────────
    const drugs: FusionDrug[] = [];
    for (const item of merged) {
      const matched = await matchMedication(item, masterByCode);
      const matchConf = matched.matchedMedicationId ? matched.matchConfidence : 0;
      const modelConf = clamp01_100(item.confidence);
      const finalConfidence = matched.matchedMedicationId
        ? Math.min(modelConf, matchConf)
        : Math.min(modelConf, 50); // 마스터 미매칭은 최대 50%로 캡
      const manualCheck = finalConfidence < 95;

      const bboxYPercent = locateRowInClova(item, clovaFields, clovaImageHeight);
      drugs.push({
        insuranceCode: { value: matched.insuranceCode, confidence: matched.matchedMedicationId ? 100 : modelConf },
        companyName:   { value: matched.companyName,   confidence: matched.matchedMedicationId ? 100 : modelConf },
        productName:   { value: matched.productName,   confidence: matched.matchedMedicationId ? 100 : modelConf },
        quantity:      { value: item.quantity,         confidence: modelConf },
        unitPrice: matched.unitPrice,
        matchedMedicationId: matched.matchedMedicationId,
        finalConfidence,
        manualCheck,
        bboxYPercent,
      });
    }

    const avgConfidence = drugs.length
      ? Math.round(drugs.reduce((s, d) => s + d.finalConfidence, 0) / drugs.length)
      : 0;
    const manualCheckCount = drugs.filter((d) => d.manualCheck).length;

    const result: FusionResult = {
      source: "fusion",
      drugs,
      avgConfidence,
      manualCheckCount,
      rawClovaText: clovaText,
      rawGeminiText: geminiText,
      hospitalName: { value: "", confidence: 0 },
      institutionCode: { value: "", confidence: 0 },
      prescriptionDate: { value: "", confidence: 0 },
      patientName: { value: "", confidence: 0 },
    };

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── Clova OCR 호출 ────────────────────────────────────────────────────────────

interface ClovaField {
  inferText: string;
  inferConfidence: number;
  lineBreak?: boolean;
  boundingPoly?: { vertices: { x: number; y: number }[] };
}

async function callClovaOcr(
  base64: string,
  ext: string
): Promise<{ text: string; fields: ClovaField[]; imageHeight: number }> {
  const rawUrl = process.env.CLOVA_OCR_INVOKE_URL?.trim();
  const clovaUrl = rawUrl?.replace(/^http:\/\//, "https://");
  const clovaSecret = process.env.CLOVA_OCR_SECRET_KEY?.trim();
  if (!clovaUrl || !clovaSecret) throw new Error("CLOVA env 미설정");

  const format = ["png", "gif", "bmp", "tiff"].includes(ext) ? ext : "jpg";
  const res = await fetch(clovaUrl, {
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
  if (!res.ok) throw new Error(`Clova ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  const image = data.images?.[0];
  if (!image || image.inferResult !== "SUCCESS") throw new Error(image?.message ?? "Clova 인식 실패");

  const fields: ClovaField[] = image.fields || [];
  const lines: string[] = [];
  let cur = "";
  for (const f of fields) {
    cur += (cur ? " " : "") + f.inferText;
    if (f.lineBreak !== false) { lines.push(cur.trim()); cur = ""; }
  }
  if (cur) lines.push(cur.trim());
  // 이미지 높이는 Clova가 직접 안 주므로 모든 vertex Y 값의 max로 근사
  let imageHeight = 0;
  for (const f of fields) {
    for (const v of f.boundingPoly?.vertices ?? []) {
      if (v.y > imageHeight) imageHeight = v.y;
    }
  }
  return { text: lines.join("\n"), fields, imageHeight };
}

// 약품의 보험코드 또는 제품명 일부가 포함된 Clova field를 찾아 그 행의 Y%를 계산
function locateRowInClova(
  item: { insuranceCode: string; productName: string },
  fields: ClovaField[],
  imageHeight: number
): number | null {
  if (!fields.length || !imageHeight) return null;
  const code = item.insuranceCode.replace(/\D/g, "");
  const productKey = item.productName.replace(/\s+/g, "").slice(0, 5).toLowerCase();
  for (const f of fields) {
    const t = f.inferText.replace(/\s+/g, "").toLowerCase();
    const matched = (code.length === 9 && t.includes(code)) || (productKey.length >= 3 && t.includes(productKey));
    if (!matched) continue;
    const ys = (f.boundingPoly?.vertices ?? []).map((v) => v.y);
    if (!ys.length) continue;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    return Math.max(0, Math.min(100, Math.round((cy / imageHeight) * 1000) / 10));
  }
  return null;
}

// ── Gemini Vision OCR ─────────────────────────────────────────────────────────

interface GeminiVisionDrug {
  insuranceCode: string;
  productName: string;
  companyName: string;
  quantity: string;
  confidence: number; // 0-100, 자체평가
}

interface GeminiVisionResult {
  drugs: GeminiVisionDrug[];
}

async function callGeminiVision(base64: string, mimeType: string): Promise<GeminiVisionResult> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 미설정");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = `당신은 한국 병원 처방전/처방통계 이미지 분석 전문가입니다.
이미지에서 처방된 의약품을 모두 추출하세요.

각 약품마다 다음을 추출:
- insuranceCode: 9자리 숫자 보험코드 (없으면 빈 문자열)
- productName: 약품 제품명 (예: "아모디핀정 5mg")
- companyName: 제약회사명 (예: "한미약품")
- quantity: 처방 수량/투여량 (숫자만)
- confidence: 이 행의 인식 확신도 (0~100 정수)

엄격한 규칙:
- 제품명에 "(주)"가 들어있으면 회사명 일부이므로 제거
- 행 헤더(약품명, 코드, 수량 등)는 약품이 아니므로 제외
- 합계/소계 행은 제외
- 알 수 없는 필드는 빈 문자열, confidence 는 본인 평가

JSON 형식으로만 응답:
{ "drugs": [ { "insuranceCode": "...", "productName": "...", "companyName": "...", "quantity": "...", "confidence": 0 } ] }`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: prompt },
      ],
    }],
    config: { responseMimeType: "application/json" },
  });

  const text = response.text ?? "";
  const parsed = parseJsonLoose(text) as Partial<GeminiVisionResult> | null;
  const drugs = Array.isArray(parsed?.drugs) ? parsed!.drugs : [];
  return {
    drugs: drugs.map((d) => ({
      insuranceCode: String(d.insuranceCode ?? "").trim(),
      productName: String(d.productName ?? "").trim(),
      companyName: String(d.companyName ?? "").trim(),
      quantity: String(d.quantity ?? "").trim(),
      confidence: clamp01_100(Number(d.confidence) || 0),
    })),
  };
}

// ── Gemini 병합/검증 LLM ──────────────────────────────────────────────────────

interface MergedDrug {
  insuranceCode: string;
  productName: string;
  companyName: string;
  quantity: string;
  confidence: number;
}

async function callGeminiMerge(args: {
  clovaText: string;
  geminiDraft: GeminiVisionResult | null;
  masterCandidates: Array<{ insuranceCode: string | null; productName: string; companyName: string }>;
}): Promise<MergedDrug[]> {
  if (!process.env.GEMINI_API_KEY) {
    // Gemini 미설정이면 Vision 결과만 사용
    return args.geminiDraft?.drugs ?? [];
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = `당신은 처방전 OCR 결과를 검증/병합하는 전문가입니다.
두 OCR 엔진의 결과를 비교하고 마스터 DB 후보를 참고해 가장 정확한 약품 리스트를 만드세요.

# Clova OCR 텍스트
${args.clovaText || "(없음)"}

# Gemini Vision 추출 결과
${args.geminiDraft ? JSON.stringify(args.geminiDraft.drugs, null, 2) : "(없음)"}

# 마스터 DB 후보 (보험코드로 사전 조회됨)
${args.masterCandidates.length ? JSON.stringify(args.masterCandidates, null, 2) : "(없음)"}

규칙:
- 두 OCR 결과가 일치하면 confidence 95+
- 한 쪽만 인식했거나 불일치면 confidence 60~85
- 마스터 DB 후보와 보험코드/제품명이 정확히 일치하면 confidence 100
- 마스터에 없는 약품도 일단 포함 (사람이 확인하도록)
- 헤더, 합계, 비약품 행은 제외
- quantity 는 숫자만 (단위 제외)

JSON 응답:
{ "drugs": [ { "insuranceCode": "...", "productName": "...", "companyName": "...", "quantity": "...", "confidence": 0 } ] }`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
    const parsed = parseJsonLoose(response.text ?? "") as { drugs?: MergedDrug[] } | null;
    const drugs = Array.isArray(parsed?.drugs) ? parsed!.drugs : (args.geminiDraft?.drugs ?? []);
    return drugs.map((d) => ({
      insuranceCode: String(d.insuranceCode ?? "").trim(),
      productName: String(d.productName ?? "").trim(),
      companyName: String(d.companyName ?? "").trim(),
      quantity: String(d.quantity ?? "").trim(),
      confidence: clamp01_100(Number(d.confidence) || 0),
    }));
  } catch {
    return args.geminiDraft?.drugs ?? [];
  }
}

// ── 마스터 DB 매칭 ────────────────────────────────────────────────────────────

type MasterRow = {
  id: string;
  insuranceCode: string | null;
  productName: string;
  companyName: string;
  price: number | null;
};

function extractInsuranceCodes(clovaText: string, gemini: GeminiVisionResult | null): string[] {
  const set = new Set<string>();
  for (const m of clovaText.matchAll(/\b(\d{9})\b/g)) set.add(m[1]);
  for (const d of gemini?.drugs ?? []) {
    const code = d.insuranceCode.replace(/\D/g, "");
    if (code.length === 9) set.add(code);
  }
  return Array.from(set);
}

async function fetchMasterByCodes(codes: string[]): Promise<Map<string, MasterRow>> {
  const map = new Map<string, MasterRow>();
  if (codes.length === 0) return map;
  const rows = await prisma.medication.findMany({
    where: { insuranceCode: { in: codes } },
    select: { id: true, insuranceCode: true, productName: true, companyName: true, price: true },
  });
  for (const r of rows) {
    if (r.insuranceCode) map.set(r.insuranceCode, r);
  }
  return map;
}

async function matchMedication(
  item: MergedDrug,
  masterByCode: Map<string, MasterRow>
): Promise<{
  insuranceCode: string;
  productName: string;
  companyName: string;
  unitPrice: number | null;
  matchedMedicationId: string | null;
  matchConfidence: number;
}> {
  const code = item.insuranceCode.replace(/\D/g, "");
  if (code.length === 9 && masterByCode.has(code)) {
    const m = masterByCode.get(code)!;
    return {
      insuranceCode: code,
      productName: m.productName,
      companyName: m.companyName,
      unitPrice: m.price,
      matchedMedicationId: m.id,
      matchConfidence: 100,
    };
  }

  // productName 부분 일치 fallback
  if (item.productName.length >= 3) {
    const candidates = await prisma.medication.findMany({
      where: { productName: { contains: item.productName.slice(0, 8), mode: "insensitive" } },
      select: { id: true, insuranceCode: true, productName: true, companyName: true, price: true },
      take: 5,
    });
    const exact = candidates.find((c: MasterRow) => c.productName === item.productName);
    const partial = exact ?? candidates[0];
    if (partial) {
      return {
        insuranceCode: partial.insuranceCode ?? item.insuranceCode,
        productName: partial.productName,
        companyName: partial.companyName,
        unitPrice: partial.price,
        matchedMedicationId: partial.id,
        matchConfidence: exact ? 95 : 80,
      };
    }
  }

  return {
    insuranceCode: item.insuranceCode,
    productName: item.productName,
    companyName: item.companyName,
    unitPrice: null,
    matchedMedicationId: null,
    matchConfidence: 0,
  };
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function clamp01_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 1 && n > 0) return Math.round(n * 100); // 0~1 들어오면 % 변환
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseJsonLoose(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fallthrough */ }
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
