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
    const clientId = (formData.get("clientId") as string | null)?.trim() || null;

    // 거래처 컨텍스트 (이전 확정 데이터에서 자주 처방한 약품 — 소프트 힌트)
    const clientContext = clientId ? await fetchClientContext(clientId, user.id, user.role) : [];

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
      callGeminiVision(base64, mimeType, clientContext),
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
          clientContext,
        });

    // 거래처 컨텍스트와 매칭되면 confidence +5 보너스 (anchoring 방지를 위해 cap)
    const contextKeys = new Set(
      clientContext.map((c) => (c.insuranceCode || c.productName).toLowerCase())
    );
    const boostedMerged = merged.map((m) => {
      const key = (m.insuranceCode || m.productName).toLowerCase();
      const inContext = contextKeys.has(key);
      return inContext ? { ...m, confidence: Math.min(100, m.confidence + 5) } : m;
    });

    // ── 4단계: 약품마다 마스터 매칭 + 신뢰도 계산 ──────────────────────────
    const drugs: FusionDrug[] = [];
    for (const item of boostedMerged) {
      const matched = await matchMedication(item, masterByCode);
      // 데이터 완성도 기반 baseline (LLM 자체신뢰도가 누락/0 이어도 합리적 값 보장)
      const fieldsFilled =
        (item.productName ? 1 : 0) +
        (item.companyName ? 1 : 0) +
        (item.quantity ? 1 : 0) +
        (item.insuranceCode.replace(/\D/g, "").length === 9 ? 1 : 0);
      const completeness = fieldsFilled >= 4 ? 90 : fieldsFilled === 3 ? 80 : fieldsFilled === 2 ? 65 : 50;
      const llmConf = clamp01_100(item.confidence);
      const baselineConf = Math.max(llmConf, completeness);
      // 마스터 매칭 시 매칭 신뢰도가 곧 finalConfidence (마스터 정보가 권위 있음)
      // 미매칭이어도 baselineConf 그대로 사용 (50% 캡 제거)
      const finalConfidence = matched.matchedMedicationId
        ? matched.matchConfidence
        : baselineConf;
      const manualCheck = finalConfidence < 95;

      const bboxYPercent = locateRowInClova(item, clovaFields, clovaImageHeight);
      drugs.push({
        insuranceCode: { value: matched.insuranceCode, confidence: matched.matchedMedicationId ? 100 : baselineConf },
        companyName:   { value: matched.companyName,   confidence: matched.matchedMedicationId ? 100 : baselineConf },
        productName:   { value: matched.productName,   confidence: matched.matchedMedicationId ? 100 : baselineConf },
        quantity:      { value: item.quantity,         confidence: baselineConf },
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
  // 이미지 실제 높이 — Clova v2 가 convertedImageInfo 로 알려주면 그 값 사용,
  // 없으면 모든 vertex Y 의 max + 약간의 여유로 근사 (텍스트 아래 여백 보정)
  let imageHeight = 0;
  const cii = image.convertedImageInfo;
  if (cii && typeof cii.height === "number" && cii.height > 0) {
    imageHeight = cii.height;
  } else {
    for (const f of fields) {
      for (const v of f.boundingPoly?.vertices ?? []) {
        if (v.y > imageHeight) imageHeight = v.y;
      }
    }
    // 텍스트 max Y 는 이미지의 실제 끝이 아니라 글자 끝이므로 살짝 키워 % 계산을 보수적으로
    imageHeight = Math.round(imageHeight * 1.05);
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

// ── 거래처 컨텍스트 (이전 확정 처방 → 자주 나오는 약품 top N) ─────────────────

interface ClientContextDrug {
  insuranceCode: string;
  productName: string;
  companyName: string;
}

async function fetchClientContext(
  clientId: string,
  userId: string,
  role: string
): Promise<ClientContextDrug[]> {
  const client = await prisma.userClient.findUnique({ where: { id: clientId }, select: { userId: true } });
  if (!client) return [];
  if (role !== "ADMIN" && client.userId !== userId) return [];

  const recent = await prisma.prescriptionReport.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 24,
    select: { ocrData: true, createdAt: true },
  });

  type Cell = { drug: ClientContextDrug; weight: number };
  const counter = new Map<string, Cell>();
  const now = Date.now();
  for (const r of recent) {
    const data = r.ocrData;
    if (!data || typeof data !== "object") continue;
    const final = (data as Record<string, unknown>).finalDrugs;
    if (!Array.isArray(final)) continue;
    const ageMonths = (now - r.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30);
    const w = ageMonths <= 3 ? 2 : 1;
    for (const d of final) {
      if (!d || typeof d !== "object") continue;
      const x = d as Record<string, unknown>;
      const productName = String(x.productName ?? "").trim();
      if (!productName) continue;
      const insuranceCode = String(x.insuranceCode ?? "").trim();
      const companyName = String(x.companyName ?? "").trim();
      const key = (insuranceCode && insuranceCode.length === 9 ? `c:${insuranceCode}` : `n:${productName}`).toLowerCase();
      const cur = counter.get(key);
      if (cur) cur.weight += w;
      else counter.set(key, { drug: { insuranceCode, productName, companyName }, weight: w });
    }
  }
  return Array.from(counter.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 30)
    .map((x) => x.drug);
}

function clientContextHint(ctx: ClientContextDrug[]): string {
  if (!ctx.length) return "";
  const lines = ctx
    .slice(0, 30)
    .map((d) => `- ${d.productName}${d.companyName ? ` (${d.companyName})` : ""}${d.insuranceCode ? ` [${d.insuranceCode}]` : ""}`)
    .join("\n");
  return `\n\n# 이 거래처가 자주 처방하는 약품 (참고용 — 강제 매칭 X, 단지 후보)\n흐릿하거나 애매한 글자가 아래 후보와 유사하면 이쪽일 가능성이 높습니다. 하지만 이미지에 명백히 다른 약품이 보이면 그걸 우선해서 추출하세요.\n${lines}`;
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

async function callGeminiVision(
  base64: string,
  mimeType: string,
  clientContext: ClientContextDrug[] = []
): Promise<GeminiVisionResult> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 미설정");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = `당신은 한국 병원의 다양한 EMR 처방통계 표를 읽는 전문가입니다.

# 작업 순서
1. 먼저 표의 **헤더(컬럼명)** 를 식별하세요. EMR마다 컬럼 구성이 다릅니다.
   - 가능한 헤더: 약품코드, 약품명, 제품명, 약품영형/제형, 단위, 수량, 일수,
     총투여량, 총사용량, 단가, 금액, 송금액, 제약회사, 제약사, 보험코드, 청구코드
2. 각 약품 행에서 헤더에 맞춰 값을 뽑으세요.
3. 합계/소계, 검색기간, 내원구분/급비구분 같은 메타데이터 행은 제외하세요.

# 출력 필드
- insuranceCode: **9자리 숫자**인 경우만 채움. EMR 내부 약품코드(예: mosapit, ultra5)
  는 9자리가 아니면 빈 문자열로 두세요.
- productName: 정확한 제품명 (예: "모사피트정5밀리그람"). 약품명/제품명 컬럼 사용
- companyName: 제약회사명 ("(주)" 표기는 유지해도 됨, 단 이름 끝의 (주)는 제거)
- quantity: 처방 수량/투여량/총사용량 컬럼 값. 숫자만
- confidence: 이 행 인식 확신도 0~100 (제품명·수량·제약사 모두 명확하면 90+,
  제품명만 명확하면 70~85, 일부 결손 50~70)

# 중요
- **보험코드가 없어도 제품명이 명확하면 반드시 추출**하세요 (confidence 70+).
- 한 약품의 여러 행은 각각 별도로 추출하세요 (예: 같은 약을 여러 환자에게 처방한 경우).

JSON: { "drugs": [ { "insuranceCode": "", "productName": "", "companyName": "", "quantity": "", "confidence": 0 } ] }${clientContextHint(clientContext)}`;

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
  clientContext: ClientContextDrug[];
}): Promise<MergedDrug[]> {
  if (!process.env.GEMINI_API_KEY) {
    // Gemini 미설정이면 Vision 결과만 사용
    return args.geminiDraft?.drugs ?? [];
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = `당신은 한국 EMR의 처방통계 표를 OCR 결과로부터 재구성하는 전문가입니다.

# 입력 1: Clova OCR 라인 단위 텍스트 (가장 신뢰할 수 있는 raw 데이터)
${args.clovaText || "(없음)"}

# 입력 2: Gemini Vision 의 1차 구조화 결과
${args.geminiDraft && args.geminiDraft.drugs.length ? JSON.stringify(args.geminiDraft.drugs, null, 2) : "(비어있음 — Clova 텍스트를 기반으로 직접 추출하세요)"}

# 입력 3: 마스터 DB 후보 (Clova 가 뽑은 9자리 보험코드로 사전 조회)
${args.masterCandidates.length ? JSON.stringify(args.masterCandidates, null, 2) : "(없음)"}

# 작업
1. Clova 텍스트에서 약품 행들을 식별. 헤더 라인(약품코드/약품명/총투여량/단가/송금액 등)을
   먼저 찾아 컬럼 구조를 추론.
2. Vision 결과가 비어있으면 Clova 텍스트만으로 약품 리스트 추출.
3. 양쪽 모두 있으면 일치 항목은 신뢰도↑, 불일치는 Clova를 우선.
4. 마스터 DB 후보에 매칭되는 행이 있으면 정확한 productName/companyName 으로 보정.

# 규칙
- 9자리 숫자가 아닌 EMR 내부 코드(mosapit, ultra5 등)는 insuranceCode 에 넣지 말고
  빈 문자열로 두기.
- 보험코드 없어도 제품명 명확하면 추출 (confidence 70+).
- 헤더, 합계, 검색기간, 내원구분 같은 메타 라인은 제외.
- quantity 는 숫자만.
- confidence: 양쪽 OCR 일치 90+, 한쪽만 70~85, 마스터 매칭 시 95+.

JSON: { "drugs": [ { "insuranceCode": "", "productName": "", "companyName": "", "quantity": "", "confidence": 0 } ] }${clientContextHint(args.clientContext)}`;

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

  // productName + companyName 동시 매치가 가장 강함
  if (item.productName.length >= 3 && item.companyName.length >= 2) {
    const companyKey = item.companyName.replace(/\(주\)|\(유\)|주식회사|㈜/g, "").trim();
    const candidates = await prisma.medication.findMany({
      where: {
        productName: { contains: item.productName.slice(0, 8), mode: "insensitive" },
        companyName: { contains: companyKey.slice(0, 6), mode: "insensitive" },
      },
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
        matchConfidence: exact ? 98 : 90,
      };
    }
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
        matchConfidence: exact ? 92 : 78,
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
