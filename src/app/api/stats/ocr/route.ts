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
    const clovaRows = clovaResult?.rows ?? [];
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
    interface PendingDrug {
      insuranceCode: Field;
      companyName: Field;
      productName: Field;
      quantity: Field;
      unitPrice: number | null;
      matchedMedicationId: string | null;
      finalConfidence: number;
      manualCheck: boolean;
      anchorY: number | null;       // locator 가 자신 있게 찾은 경우 raw % (없으면 보간 대상)
      productNameRaw: string;       // 보간 후처리에서도 매칭 시도 가능하게 유지
      insuranceCodeRaw: string;
    }
    const pendingDrugs: PendingDrug[] = [];
    for (const item of boostedMerged) {
      const matched = await matchMedication(item, masterByCode);
      const fieldsFilled =
        (item.productName ? 1 : 0) +
        (item.companyName ? 1 : 0) +
        (item.quantity ? 1 : 0) +
        (item.insuranceCode.replace(/\D/g, "").length === 9 ? 1 : 0);
      const completeness = fieldsFilled >= 4 ? 90 : fieldsFilled === 3 ? 80 : fieldsFilled === 2 ? 65 : 50;
      const llmConf = clamp01_100(item.confidence);
      const baselineConf = Math.max(llmConf, completeness);
      const finalConfidence = matched.matchedMedicationId ? matched.matchConfidence : baselineConf;
      const manualCheck = finalConfidence < 95;

      pendingDrugs.push({
        insuranceCode: { value: matched.insuranceCode, confidence: matched.matchedMedicationId ? 100 : baselineConf },
        companyName:   { value: matched.companyName,   confidence: matched.matchedMedicationId ? 100 : baselineConf },
        productName:   { value: matched.productName,   confidence: matched.matchedMedicationId ? 100 : baselineConf },
        quantity:      { value: item.quantity,         confidence: baselineConf },
        unitPrice: matched.unitPrice,
        matchedMedicationId: matched.matchedMedicationId,
        finalConfidence,
        manualCheck,
        anchorY: locateRowInClova(item, clovaRows, clovaImageHeight),
        productNameRaw: matched.productName || item.productName,
        insuranceCodeRaw: (matched.insuranceCode || item.insuranceCode).replace(/\D/g, ""),
      });
    }

    // ── 4-2단계: bboxYPercent 계산 — 견고한 위치 정렬 ──────────────────────
    // 개별 텍스트 매칭(locator) 은 OCR 분할/오탈자에 취약. 다음 전략으로 보강:
    //   1) anchor (locator 가 찾은 위치) 가 단조 증가하면 그대로 사용
    //   2) anchor 가 비어있거나 비단조면 인덱스 비례 (10~90% 영역)
    //   3) 인접 anchor 가 있으면 그 사이 선형 보간
    const N = pendingDrugs.length;
    const cleanAnchors: Array<{ idx: number; y: number } | null> = pendingDrugs.map(
      (d, i) => (d.anchorY != null ? { idx: i, y: d.anchorY } : null)
    );
    // 단조성 위반 anchor 는 버림 (잘못된 매칭일 가능성)
    let prevY = -Infinity;
    for (let i = 0; i < cleanAnchors.length; i++) {
      const a = cleanAnchors[i];
      if (!a) continue;
      if (a.y < prevY) {
        cleanAnchors[i] = null;
      } else {
        prevY = a.y;
      }
    }
    function fallbackY(i: number): number {
      if (N <= 1) return 50;
      return 10 + (i / (N - 1)) * 80;
    }
    const drugs: FusionDrug[] = pendingDrugs.map((d, i) => {
      let bboxYPercent: number | null = null;
      const own = cleanAnchors[i];
      if (own) {
        bboxYPercent = own.y;
      } else {
        // 가장 가까운 이전/다음 anchor 사이 선형 보간
        let prev: { idx: number; y: number } | null = null;
        let next: { idx: number; y: number } | null = null;
        for (let j = i - 1; j >= 0; j--) { if (cleanAnchors[j]) { prev = cleanAnchors[j]; break; } }
        for (let j = i + 1; j < N; j++) { if (cleanAnchors[j]) { next = cleanAnchors[j]; break; } }
        if (prev && next) {
          const t = (i - prev.idx) / (next.idx - prev.idx);
          bboxYPercent = prev.y + t * (next.y - prev.y);
        } else if (prev || next) {
          // 한쪽 anchor 만 있으면 인덱스 비례 fallback 결과와 평균
          const onlyAnchor = (prev ?? next)!;
          const onlyAnchorFallback = fallbackY(onlyAnchor.idx);
          const myFallback = fallbackY(i);
          // anchor 가 fallback 이랑 큰 차이면 anchor 신뢰도 낮음 — fallback 우선
          bboxYPercent = Math.abs(onlyAnchor.y - onlyAnchorFallback) > 25 ? myFallback : myFallback;
        } else {
          bboxYPercent = fallbackY(i);
        }
      }
      bboxYPercent = Math.max(0, Math.min(100, Math.round(bboxYPercent * 10) / 10));
      return {
        insuranceCode: d.insuranceCode,
        companyName: d.companyName,
        productName: d.productName,
        quantity: d.quantity,
        unitPrice: d.unitPrice,
        matchedMedicationId: d.matchedMedicationId,
        finalConfidence: d.finalConfidence,
        manualCheck: d.manualCheck,
        bboxYPercent,
      };
    });

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
): Promise<{ text: string; fields: ClovaField[]; imageHeight: number; rows: ClovaRow[] }> {
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

  // 이미지 실제 높이 먼저 계산 (행 클러스터 tolerance 산정에 사용)
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
    imageHeight = Math.round(imageHeight * 1.05);
  }

  // ── Y 클러스터링으로 행 재구성 (Clova 의 lineBreak 가 비뚤어진 사진에서 신뢰 어려움) ─
  // 같은 행으로 묶을 Y 허용 오차: 이미지 높이의 1.5% (즉 처방전 약 60~80개 행 가정의
  // 대략 절반). skew 가 있어도 같은 줄의 시작/끝이 이 안에 들어옴.
  const rowTolerance = Math.max(12, Math.round(imageHeight * 0.012));
  const rows = clusterFieldsToRows(fields, rowTolerance);
  const lines = rows.map((r) => r.fields.map((f) => f.inferText).join(" ").trim());
  return { text: lines.join("\n"), fields, imageHeight, rows };
}

// Y 좌표 기준으로 필드를 행으로 묶음. skew 허용.
export interface ClovaRow {
  avgY: number;
  fields: ClovaField[];
  text: string;       // 행 내 텍스트를 X 순서로 이어붙인 결과 (검색용)
}

function fieldYCenter(f: ClovaField): number {
  const ys = (f.boundingPoly?.vertices ?? []).map((v) => v.y);
  if (!ys.length) return 0;
  return (Math.min(...ys) + Math.max(...ys)) / 2;
}

function fieldXCenter(f: ClovaField): number {
  const xs = (f.boundingPoly?.vertices ?? []).map((v) => v.x);
  if (!xs.length) return 0;
  return (Math.min(...xs) + Math.max(...xs)) / 2;
}

function clusterFieldsToRows(fields: ClovaField[], tolerance: number): ClovaRow[] {
  if (!fields.length) return [];
  const sorted = [...fields].sort((a, b) => fieldYCenter(a) - fieldYCenter(b));
  const rows: ClovaRow[] = [];
  let cur: ClovaRow | null = null;
  for (const f of sorted) {
    const y = fieldYCenter(f);
    if (cur && Math.abs(y - cur.avgY) <= tolerance) {
      cur.fields.push(f);
      // 누적 평균 갱신
      cur.avgY = (cur.avgY * (cur.fields.length - 1) + y) / cur.fields.length;
    } else {
      cur = { avgY: y, fields: [f], text: "" };
      rows.push(cur);
    }
  }
  for (const r of rows) {
    r.fields.sort((a, b) => fieldXCenter(a) - fieldXCenter(b));
    r.text = r.fields.map((f) => f.inferText).join(" ");
  }
  return rows;
}

// 약품을 행 클러스터에 매칭해 Y% 반환 — 행 단위 텍스트로 검색하므로 OCR 분할에 견고
function locateRowInClova(
  item: { insuranceCode: string; productName: string },
  rows: ClovaRow[],
  imageHeight: number
): number | null {
  if (!rows.length || !imageHeight) return null;
  const code = item.insuranceCode.replace(/\D/g, "");
  const productKey = item.productName.replace(/\s+/g, "").slice(0, 5).toLowerCase();
  for (const r of rows) {
    const t = r.text.replace(/\s+/g, "").toLowerCase();
    const matched = (code.length === 9 && t.includes(code)) || (productKey.length >= 3 && t.includes(productKey));
    if (!matched) continue;
    return Math.max(0, Math.min(100, Math.round((r.avgY / imageHeight) * 1000) / 10));
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

# 사진이 비뚤어진 경우 (중요)
사진이 카메라로 찍혀 약간 기울거나 원근 왜곡이 있을 수 있습니다.
- 약품명의 가로선(같은 글자 위/아래 라인)을 행의 기준선으로 삼고, 그 라인을 따라
  좌→우로 같은 행의 데이터를 모으세요.
- 절대 이미지 좌표 Y 가 약간 다르더라도, 시각적으로 같은 행처럼 정렬돼있다면 같은 행입니다.
- 인접 행의 숫자가 같은 행처럼 보일 때 약품명이 어느 라인에 있는지 다시 확인하세요.

# 출력 필드
- insuranceCode: **9자리 숫자**인 경우만 채움. EMR 내부 약품코드(예: mosapit, ultra5,
  처방코드 103/219+/223* 같은 짧은 숫자)는 9자리가 아니면 빈 문자열로 두세요.
- productName: 정확한 제품명 (예: "모사피트정5밀리그람", "로수듀오정(rosuva/ezt10/10)").
  약품명/제품명/처방명칭 컬럼 사용. 제약사명은 productName 끝에서 제거.
- companyName: 제약회사명 ("(주)" 표기는 유지해도 됨, 단 이름 끝의 (주)는 제거)
- quantity: **반드시 "사용량"·"총사용량"·"총투여량"·"수량" 컬럼의 값**.
  ⚠️ 절대 단가/금액/총액/환자수가 아님. 헤더에 "단가"라고 적힌 컬럼은 단위가격이지
  수량이 아닙니다. 헤더에 "환자수"는 환자 명수이지 약품 수량이 아닙니다.
  표 헤더 예시: [처방코드 / 처방명칭 / 환자수 / 단가 / 사용량 / 총액] →
  수량 = 사용량 컬럼 값. 단가(118)·환자수(36)·총액(70446)을 절대 수량으로 쓰지 마세요.
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
- quantity 는 **사용량·총사용량·총투여량·수량 컬럼의 숫자만**. 단가/환자수/총액
  컬럼 값은 절대 수량이 아니다. 표 헤더가 [처방코드/처방명칭/환자수/단가/사용량/총액]
  이면 사용량 컬럼만 사용.
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

  // 한글 약품 prefix + 용량 분리
  // 예: "로수듀오정(rosuva/ezt10/20)HLB제약" → korean="로수듀오정", dose="10/20"
  // 예: "셀토젯정Atorva/ezt10/10mg셀트리온" → korean="셀토젯정", dose="10/10"
  // 예: "디오디핀정(amlo+valsar5/80mg)알리코" → korean="디오디핀정", dose="5/80"
  const parsed = parseDrugName(item.productName);
  const koreanCore = parsed.korean;
  const doseToken = parsed.dose;

  async function searchAndPick(
    where: object,
    requireDose: boolean
  ): Promise<{ row: MasterRow; exact: boolean } | null> {
    const rows = await prisma.medication.findMany({
      where,
      select: { id: true, insuranceCode: true, productName: true, companyName: true, price: true },
      take: 20,
    });
    if (rows.length === 0) return null;
    // 용량 필터 — 마스터 productName에 dose token이 포함되는 row 우선
    let pool = rows;
    if (requireDose && doseToken) {
      const filtered = rows.filter((r: MasterRow) => normalizeForDose(r.productName).includes(normalizeForDose(doseToken)));
      if (filtered.length) pool = filtered;
    }
    const exact = pool.find((r: MasterRow) => r.productName === item.productName);
    return { row: exact ?? pool[0], exact: !!exact };
  }

  // 1차: 한글 약품명 + 제약사 + dose
  if (koreanCore.length >= 2 && item.companyName.length >= 2) {
    const companyKey = item.companyName.replace(/\(주\)|\(유\)|주식회사|㈜/g, "").trim();
    const r = await searchAndPick(
      {
        productName: { contains: koreanCore, mode: "insensitive" },
        companyName: { contains: companyKey.slice(0, 6), mode: "insensitive" },
      },
      true
    );
    if (r) return {
      insuranceCode: r.row.insuranceCode ?? item.insuranceCode,
      productName: r.row.productName,
      companyName: r.row.companyName,
      unitPrice: r.row.price,
      matchedMedicationId: r.row.id,
      matchConfidence: r.exact ? 98 : 92,
    };
  }

  // 2차: 한글 약품명 + dose (제약사 무시 — Vision/Clova가 회사명을 못 잡았을 때)
  if (koreanCore.length >= 2) {
    const r = await searchAndPick(
      { productName: { contains: koreanCore, mode: "insensitive" } },
      true
    );
    if (r) return {
      insuranceCode: r.row.insuranceCode ?? item.insuranceCode,
      productName: r.row.productName,
      companyName: r.row.companyName,
      unitPrice: r.row.price,
      matchedMedicationId: r.row.id,
      matchConfidence: r.exact ? 95 : 85,
    };
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

// "로수듀오정(rosuva/ezt10/20)HLB제약" 같은 OCR 결과에서 한글 약품명과 용량을 분리.
function parseDrugName(s: string): { korean: string; dose: string } {
  if (!s) return { korean: "", dose: "" };
  // 한글 + 한글 사이 공백/숫자 허용 (정/캡슐/시럽 등 제형 포함). 영문 또는 ( 가 나오면 종료.
  const koreanMatch = s.match(/^[\s]*([가-힣][가-힣\s]*(?:정|캡슐|캅셀|시럽|주사액|주사|연고|크림|겔|패취|포|산제|환제|액|주|에스|서방정|장용정)?)/);
  const korean = (koreanMatch?.[1] ?? "").replace(/\s+$/, "").trim();
  // 용량: 숫자/숫자 또는 단일 숫자 + mg/g/밀리그램 허용
  const doseMatch = s.match(/(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/);
  const dose = doseMatch?.[1]?.replace(/\s+/g, "") ?? "";
  return { korean, dose };
}

// 마스터 productName 안에서 dose 비교 시 표기 차이(공백/단위) 흡수
function normalizeForDose(s: string): string {
  return s.toLowerCase()
    .replace(/\s+/g, "")
    .replace(/밀리그램|밀리그람/g, "mg")
    .replace(/마이크로그램|마이크로그람/g, "ug");
}

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
