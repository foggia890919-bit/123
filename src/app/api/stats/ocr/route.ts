import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { callDocumentAi, isDocumentAiConfigured, type DocAiResult } from "@/lib/document-ai";
import {
  classifyVendor,
  isVendorCompatible,
  type EmrVendor,
  type CaptureType,
  type VendorClassification,
} from "@/lib/ocr-vendor-classifier";

export const runtime = "nodejs";
export const maxDuration = 90;

// ── 응답 타입 ─────────────────────────────────────────────────────────────────

interface Field {
  value: string;
  confidence: number; // 0-100
}

export interface DrugDebug {
  // 모두 0~1 비율 (이미지 너비/높이 기준)
  anchorXPct: number;        // 약품명 anchor field 의 X 중심
  anchorTopPct: number;      // 약품명 anchor field 의 윗선 (밴드 위)
  anchorBotPct: number;      // 약품명 anchor field 의 아랫선 (밴드 아래)
  slopePerWidth: number;     // 행 기울기 (dy / imageWidth — 1.0 이면 imageWidth 만큼 X 이동 시 imageHeight 만큼 Y 변화)
  qtyBoxPct: { left: number; top: number; right: number; bottom: number } | null;  // 매칭된 사용량 bbox
}

export interface FusionDrug {
  insuranceCode: Field;
  companyName: Field;
  productName: Field;
  quantity: Field;
  unitPrice: number | null;          // 마스터 DB 단가
  commissionRate: number | null;     // 마스터 수수료율 (%)
  additionalRate: number | null;     // 사용자 추가 수수료율 (%) — MemberCompanyRate
  matchedMedicationId: string | null;
  finalConfidence: number;            // 최종 신뢰도 0-100
  manualCheck: boolean;               // < 95 이면 true
  bboxYPercent: number | null;        // 이미지 내 행의 Y 중심 (0~100), 없으면 null
  debug: DrugDebug | null;            // 행 밴드 시각화용 (디버그 토글에서 사용)
}

// 거래처별 EMR 표 양식 — 컬럼 X 좌표를 이미지 너비 비율로 저장. 다음 사진 OCR 시 그대로
// 재사용해 LLM 컬럼 추측을 우회한다. PrescriptionReport.ocrData 안에 같이 보관.
// vendor 는 캐시 호환성 체크용 — 같은 거래처가 EMR 두 개를 쓰는 경우 (예: 늘편한내과 종이/모니터)
// 잘못된 템플릿이 적용되지 않도록 한다.
export interface ColumnTemplate {
  insuranceCode: number | null;   // 0~1, X / imageWidth
  productName: number | null;
  patientCount: number | null;
  unitPrice: number | null;
  quantity: number | null;
  total: number | null;
  detectedAt: string;
  source: "auto" | "manual" | "cached";
  vendor?: EmrVendor;             // 이 템플릿이 어느 EMR 화면에서 학습됐는지
  captureType?: CaptureType;      // 어느 캡처 종류(사진/스크린샷/모니터) 에서 학습됐는지
}

// 파이프라인 단계별 진단 정보 — 어느 단계에서 약품이 사라졌는지 추적용
export interface PipelineDiagnostics {
  // 0단계: vendor / capture-type 분류
  vendor: EmrVendor;
  captureType: CaptureType;
  vendorConfidence: number;
  vendorRationale: string;
  vendorError: string | null;
  // 캐시 적용 결과 — 캐시가 있었으나 vendor 가 달라 거부된 경우 사용자가 알 수 있게
  cachedTemplateVendor: EmrVendor | null;   // 마지막 저장된 템플릿의 vendor (없으면 null)
  cacheHit: boolean;                         // 이번 요청에서 캐시를 실제로 적용했는지
  cacheRejectReason: string | null;          // 캐시는 있었으나 안 쓴 이유 (vendor mismatch 등)
  clovaOk: boolean;
  clovaChars: number;
  clovaError: string | null;
  visionOk: boolean;
  visionDrugCount: number;
  visionError: string | null;
  mergeUsed: "skipped (vision-only)" | "vision+clova" | "clova-only" | "clova-deterministic-fallback" | "clova-positional";
  mergeDrugCount: number;
  mergeError: string | null;
  filteredByIsLikelyDrug: number;        // isLikelyDrug 에서 제거된 수
  masterMatchedCount: number;            // 마스터 매칭 성공 수
  masterUnmatchedCount: number;          // 매칭 실패 수
  dedupedCount: number;                  // dedupe 에서 제거된 중복 수
  finalCount: number;                    // 최종 응답 약품 수
  // Clova 가 본 약품명 후보 전체 — 어느 게 최종 결과에 들어갔는지 사용자가 직접 검증
  drugCandidates: Array<{
    text: string;
    yPercent: number;       // 이미지 내 Y 위치 (정렬용)
    xPercent: number;       // X 위치
    accepted: boolean;
    droppedReason: string | null;  // 탈락한 경우 이유
    // accepted=true 일 때만 채워지는 매칭 디버그 정보
    slope?: number;          // 사용된 row band slope (회귀 진단용)
    quantity?: string;       // 매칭된 사용량
    quantityY?: number;      // 매칭된 quantity field 의 raw Y — anchor Y 와 비교해 인접 행 잘못 잡힘 진단
    insuranceCode?: string;  // 같은 행에서 추출된 9자리 코드
  }>;
  // 마스터 매칭 실패한 drug 들의 (이름, 단가) 샘플 — 마스터 DB 에 약품이 없는지 vs
  // 매칭 로직 버그인지 사용자가 빨리 판단할 수 있게.
  masterUnmatchedSamples: Array<{ productName: string; unitPriceHint: number | null }>;
  // Vision · Positional 교차 검증 (clova-positional 경로 한정).
  // OCR 행이 깨진 모니터 사진에서 positional 의 행 매칭이 어긋나 quantity 가 인접 행
  // cell 로 잘못 잡히는 경우, Vision LLM 의 약품 단위 추출 결과와 비교해 의심 행을
  // 자동 표시한다. positional 만 신뢰했을 때 놓치던 회귀 행을 드러내는 안전망.
  crossValidation: Array<{
    insuranceCode: string;
    productName: string;
    positionalQuantity: string;
    visionQuantity: string;
    match: boolean;        // quantity 일치 여부
  }>;
  // Google Document AI (Form Parser) 결과 — Clova/Gemini 와 비교용. 1단계 통합:
  // 결과만 노출, 실제 약품 추출은 기존 Clova/Gemini 파이프라인 그대로 사용.
  // 다음 PR 에서 Document AI 가 더 정확하면 primary 로 승격 검토.
  docaiOk: boolean;
  docaiConfigured: boolean;
  docaiTableCount: number;          // 추출된 표 개수
  docaiTotalRowCount: number;       // 모든 표의 총 행 수
  docaiTextChars: number;
  docaiError: string | null;
  docaiSampleTable: string[][] | null; // 첫 번째 표의 처음 ~10 행 (디버그용)
}

export interface FusionResult {
  source: "fusion";
  vendor: EmrVendor;                       // 분류기가 식별한 EMR (UI 배지·통계용)
  captureType: CaptureType;                // 사진/스크린샷/모니터 — 후속 전처리 분기 키
  drugs: FusionDrug[];
  avgConfidence: number;
  manualCheckCount: number;
  rawClovaText: string;
  rawGeminiText: string;
  hospitalName: Field;
  columnTemplate: ColumnTemplate | null;   // 다음 업로드용 — 프론트가 저장 시 같이 보내야 함
  pipeline: PipelineDiagnostics;           // 어느 단계에서 약품이 사라졌는지 추적
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

    // ── 0단계: vendor 분류 + 1단계: Clova + Gemini Vision + Document AI 병렬 OCR ──
    // 동일 거래처가 EMR 두 개 (예: 모니터 사진 + 종이 사진) 를 섞어 올리는 케이스에서
    // 잘못된 ColumnTemplate 캐시 적용을 막기 위해 OCR 본 작업 전에 vendor 라벨부터 붙인다.
    const docaiConfigured = isDocumentAiConfigured();
    const [clovaOut, geminiOut, docaiOut, classifierOut] = await Promise.allSettled([
      callClovaOcr(base64, ext),
      callGeminiVision(base64, mimeType, clientContext),
      docaiConfigured ? callDocumentAi(base64, mimeType) : Promise.reject(new Error("not configured")),
      classifyVendor(base64, mimeType),
    ]);

    const classifierResult: VendorClassification =
      classifierOut.status === "fulfilled"
        ? classifierOut.value
        : { vendor: "unknown", captureType: "photo", confidence: 0, rationale: "분류기 호출 실패", error: String(classifierOut.reason).slice(0, 200) };

    const clovaResult = clovaOut.status === "fulfilled" ? clovaOut.value : null;
    const clovaText = clovaResult?.text ?? "";
    const clovaRows = clovaResult?.rows ?? [];
    const clovaImageHeight = clovaResult?.imageHeight ?? 0;
    const clovaImageWidth = clovaResult?.imageWidth ?? 0;

    // 컬럼 맵: 1) 거래처 캐시 (vendor 호환 시) → 2) 헤더 자동 감지.
    // 캐시 우선 (사용자가 한 번 검수해 저장한 결과이므로 자동 감지보다 신뢰도 높음).
    // 단, 캐시가 다른 EMR 에서 학습된 거면 거부 — 같은 거래처라도 EMR 다르면 컬럼 위치도 다름.
    const cacheInfo = clientId
      ? await fetchCachedColumnTemplate(clientId, classifierResult.vendor)
      : { template: null, savedVendor: null, rejectReason: "clientId 없음" };
    const cachedTemplate = cacheInfo.template;
    // 1차: 헤더 키워드 기반 정상 감지. 2차: 헤더 OCR 이 깨졌을 때 첫 데이터 행 기반 폴백.
    const autoColMap = findColumnMap(clovaRows) ?? findColumnMapByDataRow(clovaRows);
    const colMap: ColumnMap | null = cachedTemplate
      ? columnMapFromTemplate(cachedTemplate, clovaImageWidth, clovaRows)
      : autoColMap;
    const templateUsed: ColumnTemplate | null = colMap
      ? buildColumnTemplate(
          colMap,
          clovaImageWidth,
          cachedTemplate ? "cached" : "auto",
          classifierResult.vendor,
          classifierResult.captureType
        )
      : null;
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

    // Document AI 결과 정리 (현재 PR 에선 진단용으로만 사용)
    const docai: DocAiResult | null = docaiOut.status === "fulfilled" ? docaiOut.value : null;
    const docaiTotalRowCount = docai
      ? docai.tables.reduce((s, t) => s + t.length, 0) : 0;
    const docaiSampleTable = docai && docai.tables.length > 0
      ? docai.tables[0].slice(0, 10).map((r) => r.cells.slice(0, 8))
      : null;

    // 파이프라인 진단 누적
    const pipeline: PipelineDiagnostics = {
      vendor: classifierResult.vendor,
      captureType: classifierResult.captureType,
      vendorConfidence: classifierResult.confidence,
      vendorRationale: classifierResult.rationale,
      vendorError: classifierResult.error,
      cachedTemplateVendor: cacheInfo.savedVendor,
      cacheHit: !!cachedTemplate,
      cacheRejectReason: cachedTemplate ? null : cacheInfo.rejectReason,
      clovaOk: clovaOut.status === "fulfilled",
      clovaChars: clovaText.length,
      clovaError: clovaOut.status === "rejected" ? String(clovaOut.reason).slice(0, 200) : null,
      visionOk: geminiOut.status === "fulfilled",
      visionDrugCount: geminiDraft?.drugs.length ?? 0,
      visionError: geminiOut.status === "rejected" ? String(geminiOut.reason).slice(0, 200) : null,
      mergeUsed: "vision+clova",
      mergeDrugCount: 0,
      mergeError: null,
      filteredByIsLikelyDrug: 0,
      masterMatchedCount: 0,
      masterUnmatchedCount: 0,
      masterUnmatchedSamples: [],
      crossValidation: [],
      dedupedCount: 0,
      finalCount: 0,
      drugCandidates: [],
      docaiOk: docaiOut.status === "fulfilled",
      docaiConfigured,
      docaiTableCount: docai?.tables.length ?? 0,
      docaiTotalRowCount,
      docaiTextChars: docai?.rawText.length ?? 0,
      docaiError: docaiOut.status === "rejected"
        ? (docaiConfigured ? String(docaiOut.reason).slice(0, 300) : "환경변수 미설정")
        : null,
      docaiSampleTable,
    };

    // ── 3단계: 추출 우선순위
    //   (a) Clova positional — 행 단위 위→아래 순서, 각 행에서 컬럼 X 위치의 값 직접 픽.
    //       LLM 환각/순서 뒤집힘 없이 가장 단순. 반드시 colMap 가 있어야 함.
    //   (b) LLM 병합 — positional 이 충분히 못 뽑으면 fallback
    const visionDrugs = geminiDraft?.drugs ?? [];
    let merged: MergedDrug[];

    const positionalResult = extractDrugsPositionalWithDebug(clovaRows, colMap);
    const positionalDrugs = positionalResult.drugs;
    // 모든 약품명 후보를 진단에 첨부 — 사용자가 어느 게 채택/탈락됐는지 직접 검증
    pipeline.drugCandidates = positionalResult.candidates.map((c) => ({
      text: c.text,
      yPercent: clovaImageHeight > 0 ? Math.round((c.y / clovaImageHeight) * 1000) / 10 : 0,
      xPercent: clovaImageWidth > 0 ? Math.round((c.x / clovaImageWidth) * 1000) / 10 : 0,
      accepted: c.accepted,
      droppedReason: c.reason,
      slope: c.slope,
      quantity: c.quantity,
      quantityY: c.quantityY,
      insuranceCode: c.insuranceCode,
    }));
    if (positionalDrugs.length >= 3) {
      // positional 추출이 충분하면 LLM 호출 자체 생략 — 단가/순서 보장됨.
      // 부분 추출도 행은 유지: 어떤 한 필드라도 인식됐으면 빈칸은 검수자가 채움.
      // (이미지에 4행 있고 OCR 이 일부 필드 놓쳤어도 4행 모두 보이게)
      pipeline.mergeUsed = "clova-positional";
      merged = positionalDrugs
        .filter((p) => p.productName || p.quantity || p.insuranceCode)
        .map((p) => ({
          insuranceCode: p.insuranceCode,
          productName: p.productName,
          companyName: "",
          quantity: p.quantity,
          confidence: 80,
          priceHint: parseInt(p.unitPrice.replace(/[^\d]/g, ""), 10) || undefined,
          anchorYRaw: p.anchorY,
        }));
    } else {
      // positional 부실 시 기존 LLM 경로
      const visionAllMatched = visionDrugs.length > 0 && visionDrugs.every((d) => {
        const c = d.insuranceCode.replace(/\D/g, "");
        return c.length === 9 && masterByCode.has(c);
      });
      if (visionAllMatched) {
        pipeline.mergeUsed = "skipped (vision-only)";
        merged = visionDrugs.map((d) => ({ ...d, confidence: Math.max(d.confidence, 95) }));
      } else {
        pipeline.mergeUsed = visionDrugs.length === 0 ? "clova-only" : "vision+clova";
        try {
          merged = await callGeminiMerge({
            clovaText,
            geminiDraft,
            masterCandidates: Array.from(masterByCode.values()).map((m) => ({
              insuranceCode: m.insuranceCode,
              productName: m.productName,
              companyName: m.companyName,
            })),
            clientContext,
          });
        } catch (e) {
          pipeline.mergeError = String(e).slice(0, 200);
          merged = visionDrugs;
        }
      }
    }
    pipeline.mergeDrugCount = merged.length;

    // ── Vision · Positional 교차 검증 (clova-positional 한정) ───────────────
    // positional 이 OCR 행 깨짐 (모니터 사진처럼 같은 행이 두 줄로 분할되는 케이스) 을
    // 그대로 받는 한계 보정. Vision 은 LLM 이 약품 단위로 묶어 추출하므로,
    // 같은 보험코드의 quantity multi-set 이 두 결과에서 다르면 positional 의 행 매칭
    // 오류 가능성이 높다.
    //
    // 동작:
    //   1) 보험코드별로 positional quantities · vision quantities multi-set 수집
    //   2) 정렬 후 비교. 한쪽이라도 비어있으면 비교 skip (한 소스만 본 약품)
    //   3) 다르면 진단에 양쪽 값 노출 + 해당 코드의 모든 positional drug confidence 60
    //      으로 낮춤 → 후속 단계에서 manualCheck=true (<95) 자동 트리거
    //   4) 사용자는 검수 화면에서 빨갛게 표시된 행만 1초씩 확인하면 됨
    if (pipeline.mergeUsed === "clova-positional" && visionDrugs.length > 0) {
      const posByCode = new Map<string, string[]>();
      const productByCode = new Map<string, string>();
      for (const m of merged) {
        const code = m.insuranceCode.replace(/\D/g, "");
        if (code.length !== 9) continue;
        const qty = (m.quantity || "").replace(/[^\d.]/g, "");
        if (!qty) continue;
        const arr = posByCode.get(code) ?? [];
        arr.push(qty);
        posByCode.set(code, arr);
        if (!productByCode.has(code)) productByCode.set(code, m.productName);
      }
      const visByCode = new Map<string, string[]>();
      for (const v of visionDrugs) {
        const code = v.insuranceCode.replace(/\D/g, "");
        if (code.length !== 9) continue;
        const qty = (v.quantity || "").replace(/[^\d.]/g, "");
        if (!qty) continue;
        const arr = visByCode.get(code) ?? [];
        arr.push(qty);
        visByCode.set(code, arr);
      }
      const allCodes = new Set([...posByCode.keys(), ...visByCode.keys()]);
      for (const code of allCodes) {
        const pos = (posByCode.get(code) ?? []).slice().sort();
        const vis = (visByCode.get(code) ?? []).slice().sort();
        if (pos.length === 0 || vis.length === 0) continue;
        const match = pos.length === vis.length && pos.every((q, i) => q === vis[i]);
        pipeline.crossValidation.push({
          insuranceCode: code,
          productName: productByCode.get(code) ?? "",
          positionalQuantity: pos.join(", "),
          visionQuantity: vis.join(", "),
          match,
        });
        if (!match) {
          for (let i = 0; i < merged.length; i++) {
            const c = merged[i].insuranceCode.replace(/\D/g, "");
            if (c === code) {
              merged[i] = { ...merged[i], confidence: Math.min(merged[i].confidence, 60) };
            }
          }
        }
      }
    }

    // ── Phantom 행 교차 검증 (vision-only / vision+clova / clova-only path 한정) ─
    // Clova positional 은 PR #70 의 phantom Y-tolerance dedupe 를 거쳐 같은 행
    // 중복이 제거됨. LLM 경로(Gemini Vision) 는 좌표 정보가 없어 같은 행을 두 번
    // 반환하는 환각이 발생할 수 있음. positional 의 (insuranceCode, productName)
    // 등장 횟수를 상한으로 LLM 결과를 trim.
    //
    // 진료실 1·2 같이 정당하게 같은 약이 두 행에 들어간 경우는 positional 도 2건
    // 으로 잡혀 (Y 차이 25px+) 상한 = 2 → LLM 2건 그대로 유지됨.
    if (pipeline.mergeUsed !== "clova-positional" && positionalDrugs.length > 0) {
      const phantomKey = (insuranceCode: string, productName: string) =>
        `${insuranceCode}|${productName.replace(/\s+/g, "").toLowerCase()}`;
      const positionalCount = new Map<string, number>();
      for (const p of positionalDrugs) {
        if (!p.insuranceCode || p.insuranceCode.length !== 9) continue;
        const k = phantomKey(p.insuranceCode, p.productName);
        positionalCount.set(k, (positionalCount.get(k) ?? 0) + 1);
      }
      const seenCount = new Map<string, number>();
      const phantomTrimmed: MergedDrug[] = [];
      let phantomRemoved = 0;
      for (const m of merged) {
        const code = m.insuranceCode.replace(/\D/g, "");
        if (code.length !== 9) { phantomTrimmed.push(m); continue; }
        const k = phantomKey(code, m.productName);
        const limit = positionalCount.get(k);
        if (limit == null) { phantomTrimmed.push(m); continue; }
        const next = (seenCount.get(k) ?? 0) + 1;
        seenCount.set(k, next);
        if (next > limit) { phantomRemoved++; continue; }
        phantomTrimmed.push(m);
      }
      if (phantomRemoved > 0) {
        merged = phantomTrimmed;
        pipeline.mergeDrugCount = merged.length;
        // 진단용 로그 — mergeError 자리 빌려서 표기 (별도 필드 추가 없이)
        pipeline.mergeError = `phantom 행 ${phantomRemoved}건 제거 (positional 교차 검증)`;
      }
    }

    // FIX #19: LLM 경로에서도 priceHint 를 채워준다.
    //   Vision/Merge LLM 이 productName 만 정확히 잡고 매칭이 dose 변형으로 떨어질 때,
    //   Clova positional 에서 같은 약품의 단가를 찾아 매칭 키로 사용 → 정확한 master row.
    if (pipeline.mergeUsed !== "clova-positional" && positionalDrugs.length > 0) {
      const positionalByName = new Map<string, PositionalDrug>();
      for (const p of positionalDrugs) {
        const key = parseDrugName(p.productName).korean.replace(/\s+/g, "").toLowerCase();
        if (key && !positionalByName.has(key)) positionalByName.set(key, p);
      }
      merged = merged.map((m) => {
        if (m.priceHint) return m;
        const key = parseDrugName(m.productName).korean.replace(/\s+/g, "").toLowerCase();
        const pos = positionalByName.get(key);
        if (pos && pos.unitPrice) {
          const price = parseInt(pos.unitPrice.replace(/[^\d]/g, ""), 10);
          if (Number.isFinite(price) && price > 0) return { ...m, priceHint: price };
        }
        return m;
      });
    }

    // LLM 둘 다 약품을 못 뽑았으면 결정론적 Clova-only 파서로 fallback.
    // (Gemini quota 초과 / 일시 outage 시에도 시스템이 동작하도록 보장)
    if (merged.length === 0 && colMap) {
      const fallback = parseDrugsFromClova(clovaRows, colMap);
      if (fallback.length > 0) {
        merged = fallback;
        pipeline.mergeUsed = "clova-deterministic-fallback";
        pipeline.mergeDrugCount = fallback.length;
      }
    }

    // 거래처 컨텍스트와 매칭되면 confidence +5 보너스 (anchoring 방지를 위해 cap)
    const contextKeys = new Set(
      clientContext.map((c) => (c.insuranceCode || c.productName).toLowerCase())
    );
    const beforeFilter = merged.length;
    const boostedMerged = merged
      // 1) 그룹/섹션 라벨 제거 — 진짜 약품명이 아닌 것 (제형 키워드 없음 + 짧은 코드만).
      //    productName 자체가 비어있으면 (다른 필드만 있는 부분 추출 행) 통과 시킴
      //    — 사용자가 수동으로 productName 채우게.
      .filter((m) => !m.productName || isLikelyDrug(m.productName))
      // 2) 거래처 컨텍스트 매칭 시 +5 보너스
      .map((m) => {
        const key = (m.insuranceCode || m.productName).toLowerCase();
        const inContext = contextKeys.has(key);
        return inContext ? { ...m, confidence: Math.min(100, m.confidence + 5) } : m;
      })
      // 3) Clova 컬럼 X 좌표로 사용량 보정 + 디버그 밴드 정보 부착
      .map((m) => {
        if (!colMap) return m;
        const r = extractByColumnMap(m.productName, clovaRows, colMap);
        const next: MergedDrug & { _extract?: ExtractResult | null } = { ...m, _extract: r };
        if (r?.quantity && r.quantity !== m.quantity.replace(/[^\d.]/g, "")) {
          next.quantity = r.quantity;
        }
        return next;
      });
    pipeline.filteredByIsLikelyDrug = beforeFilter - boostedMerged.length;

    // ── 4단계: 약품마다 마스터 매칭 + 신뢰도 계산 ──────────────────────────
    interface PendingDrug {
      insuranceCode: Field;
      companyName: Field;
      productName: Field;
      quantity: Field;
      unitPrice: number | null;
      commissionRate: number | null;
      matchedMedicationId: string | null;
      finalConfidence: number;
      manualCheck: boolean;
      anchorY: number | null;
      productNameRaw: string;       // OCR/LLM 이 추출한 원본 productName (마스터 덮어쓰기 전)
      insuranceCodeRaw: string;
      rawDose: string;              // OCR/LLM 추출 dose — dedupe 에서 다른 dose 변형 구분용
      extract: ExtractResult | null;
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
      // 빈 필드(productName/insuranceCode 누락)도 검수 대상으로 강제 — 사용자가
      // 빨간색 행으로 빠르게 식별해서 빈칸 채울 수 있게.
      const hasMissingField = !item.productName || !item.insuranceCode;
      const manualCheck = finalConfidence < 95 || hasMissingField;
      if (matched.matchedMedicationId) {
        pipeline.masterMatchedCount++;
      } else {
        pipeline.masterUnmatchedCount++;
        if (pipeline.masterUnmatchedSamples.length < 10) {
          pipeline.masterUnmatchedSamples.push({
            productName: item.productName,
            unitPriceHint: item.priceHint ?? null,
          });
        }
      }

      const itemWithExtract = item as MergedDrug & { _extract?: ExtractResult | null };
      pendingDrugs.push({
        insuranceCode: { value: matched.insuranceCode, confidence: matched.matchedMedicationId ? 100 : baselineConf },
        companyName:   { value: matched.companyName,   confidence: matched.matchedMedicationId ? 100 : baselineConf },
        productName:   { value: matched.productName,   confidence: matched.matchedMedicationId ? 100 : baselineConf },
        quantity:      { value: item.quantity,         confidence: baselineConf },
        unitPrice: matched.unitPrice,
        commissionRate: matched.commissionRate,
        matchedMedicationId: matched.matchedMedicationId,
        finalConfidence,
        manualCheck,
        // positional path 가 알고 있는 정확한 anchor Y 우선 사용 — 텍스트 검색 기반
        // locateRowInClova 는 같은 한글명 다른 dose 변형이 여러 개 있으면 잘못된 행 픽.
        anchorY: item.anchorYRaw != null && clovaImageHeight > 0
          ? Math.max(0, Math.min(100, Math.round((item.anchorYRaw / clovaImageHeight) * 1000) / 10))
          : locateRowInClova(item, clovaRows, clovaImageHeight),
        productNameRaw: item.productName,         // ← 마스터 덮어쓰기 전 LLM/Vision 원본
        insuranceCodeRaw: (matched.insuranceCode || item.insuranceCode).replace(/\D/g, ""),
        rawDose: parseDrugName(item.productName).dose,
        extract: itemWithExtract._extract ?? null,
      });
    }

    // ── 4-0단계: anchorY 기준으로 약품 순서 재정렬 ──────────────────────────
    // LLM 출력 순서가 이미지 순서와 다른 경우(가바로닌/프레리카 뒤바뀜 등) 있어서
    // 이미지의 위→아래 순서로 재정렬한다. anchorY null 인 항목은 마지막에 모으되 원래
    // 순서 유지.
    pendingDrugs.sort((a, b) => {
      if (a.anchorY == null && b.anchorY == null) return 0;
      if (a.anchorY == null) return 1;
      if (b.anchorY == null) return -1;
      return a.anchorY - b.anchorY;
    });

    // ── 4-1단계: 사용자 추가 수수료 (MemberCompanyRate) 일괄 조회 ───────────
    // 매칭된 약품들의 제약사명을 모아 한 쿼리로 가져온다. 제약사명은 normalize 후 비교.
    const matchedCompanies = Array.from(new Set(
      pendingDrugs.map((d) => d.companyName.value).filter((n) => n)
    ));
    const additionalRateByCompany = new Map<string, number>();
    if (matchedCompanies.length > 0) {
      const memberRates = await prisma.memberCompanyRate.findMany({
        where: { userId: user.id },
        select: { companyName: true, additionalRate: true },
      });
      const norm = (s: string) => s.replace(/\(주\)|\(유\)|주식회사|㈜|\s+/g, "").toLowerCase();
      for (const r of memberRates) {
        additionalRateByCompany.set(norm(r.companyName), r.additionalRate);
      }
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
      const norm = (s: string) => s.replace(/\(주\)|\(유\)|주식회사|㈜|\s+/g, "").toLowerCase();
      const additionalRate = additionalRateByCompany.get(norm(d.companyName.value)) ?? null;
      // 디버그용 — 행 밴드 ratios + 매칭된 qty bbox ratios
      let debug: DrugDebug | null = null;
      if (d.extract && clovaImageWidth > 0 && clovaImageHeight > 0) {
        const b = d.extract.band;
        const qf = d.extract.qtyField;
        let qtyBoxPct = null;
        if (qf?.boundingPoly?.vertices?.length) {
          const xs = qf.boundingPoly.vertices.map((v) => v.x);
          const ys = qf.boundingPoly.vertices.map((v) => v.y);
          qtyBoxPct = {
            left: Math.min(...xs) / clovaImageWidth,
            top: Math.min(...ys) / clovaImageHeight,
            right: Math.max(...xs) / clovaImageWidth,
            bottom: Math.max(...ys) / clovaImageHeight,
          };
        }
        debug = {
          anchorXPct: b.anchorX / clovaImageWidth,
          anchorTopPct: b.top / clovaImageHeight,
          anchorBotPct: b.bot / clovaImageHeight,
          // slope 정규화: dy/dx (raw px) → dy/imageWidth (현재 dx 1px 당 dy * imageWidth/imageHeight 정규화)
          // 프론트가 width % 단위로 X 를 다룰 때 동일한 스케일 비율로 적용 가능하게 한다.
          slopePerWidth: (b.slope * clovaImageWidth) / clovaImageHeight,
          qtyBoxPct,
        };
      }
      return {
        insuranceCode: d.insuranceCode,
        companyName: d.companyName,
        productName: d.productName,
        quantity: d.quantity,
        unitPrice: d.unitPrice,
        commissionRate: d.commissionRate,
        additionalRate,
        matchedMedicationId: d.matchedMedicationId,
        finalConfidence: d.finalConfidence,
        manualCheck: d.manualCheck,
        bboxYPercent,
        debug,
      };
    });

    // 안전망 — pendingDrugs 단계에서 dedupe. **마스터 덮어쓰기 전 OCR 원본**으로
    // 비교해 다른 약품이 같은 master 에 우연히 매칭됐어도 살린다.
    // 키에 insuranceCode 포함 — 같은 약을 진료실 1·2 에서 별도 행으로 처방한
    // 정당한 케이스가 dedupe 로 잘못 합쳐지는 것 방지.
    const seenRaw = new Set<string>();
    const dedupedPending = pendingDrugs.filter((p) => {
      const key = `${p.insuranceCode.value}|${p.productNameRaw}|${p.rawDose}|${p.quantity.value}`;
      if (seenRaw.has(key)) return false;
      seenRaw.add(key);
      return true;
    });
    pipeline.dedupedCount = pendingDrugs.length - dedupedPending.length;
    const finalDrugsList = drugs.filter((_, i) =>
      dedupedPending.includes(pendingDrugs[i])
    );
    pipeline.finalCount = finalDrugsList.length;

    const avgConfidence = finalDrugsList.length
      ? Math.round(finalDrugsList.reduce((s, d) => s + d.finalConfidence, 0) / finalDrugsList.length)
      : 0;
    const manualCheckCount = finalDrugsList.filter((d) => d.manualCheck).length;

    const result: FusionResult = {
      source: "fusion",
      vendor: classifierResult.vendor,
      captureType: classifierResult.captureType,
      drugs: finalDrugsList,
      avgConfidence,
      manualCheckCount,
      rawClovaText: clovaText,
      rawGeminiText: geminiText,
      hospitalName: { value: "", confidence: 0 },
      columnTemplate: templateUsed,
      pipeline,
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
): Promise<{ text: string; fields: ClovaField[]; imageWidth: number; imageHeight: number; rows: ClovaRow[] }> {
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

  // 이미지 실제 높이/너비 — Clova 의 convertedImageInfo 우선, 없으면 vertex max 로 근사
  let imageWidth = 0;
  let imageHeight = 0;
  const cii = image.convertedImageInfo;
  if (cii && typeof cii.height === "number" && cii.height > 0) {
    imageHeight = cii.height;
    if (typeof cii.width === "number" && cii.width > 0) imageWidth = cii.width;
  }
  if (!imageHeight || !imageWidth) {
    let maxX = 0;
    for (const f of fields) {
      for (const v of f.boundingPoly?.vertices ?? []) {
        if (v.y > imageHeight) imageHeight = v.y;
        if (v.x > maxX) maxX = v.x;
      }
    }
    if (!cii?.height) imageHeight = Math.round(imageHeight * 1.05);
    if (!imageWidth) imageWidth = Math.round(maxX * 1.05);
  }

  // ── Y 클러스터링으로 행 재구성 (Clova 의 lineBreak 가 비뚤어진 사진에서 신뢰 어려움) ─
  // 같은 행으로 묶을 Y 허용 오차: 이미지 높이의 1.5% (즉 처방전 약 60~80개 행 가정의
  // 대략 절반). skew 가 있어도 같은 줄의 시작/끝이 이 안에 들어옴.
  // 같은 행으로 묶을 Y 허용 오차: 처방통계 표는 행 간격이 좁아서 (보통 28~38px)
  // 너무 크면 인접 두 행이 한 클러스터로 합쳐져 값이 섞인다. 0.6% 로 보수적 설정.
  const rowTolerance = Math.max(8, Math.round(imageHeight * 0.006));
  const rows = clusterFieldsToRows(fields, rowTolerance);
  const lines = rows.map((r) => r.fields.map((f) => f.inferText).join(" ").trim());
  return { text: lines.join("\n"), fields, imageWidth, imageHeight, rows };
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

// 진짜 약품명인지 휴리스틱 판정 — 그룹/섹션 라벨(NH팜, 합계, 등) 제외용.
// 한국 처방통계는 거의 모두 "정/캡슐/시럽/주사/연고/크림/액/포/패취/산제/환제" 같은 제형
// 어미가 들어간다. 영어 INN 만 적힌 경우(예: rosuvastatin)도 약품명으로 인정.
// LLM 없이 Clova rows + ColumnMap 만으로 약품 추출하는 결정론적 파서.
// LLM 이 quota / outage 로 실패할 때 안전망. 약품명/수량/보험코드(있을 때) 만 뽑는다.
// 단순 위치 기반 추출: Clova 행을 위→아래로 훑으면서 같은 행 안에서 컬럼 X 에 가장
// 가까운 값을 잡는다. slope/band 없음. 행 안의 fields 는 이미 같은 cluster (Clova 의
// Y-cluster) 라 같은 행으로 봐도 안전. unit price 까지 같이 뽑아서 마스터 매칭 시
// 이름 + 가격으로 정확한 row 픽 가능 (예: 로수듀오 10/10 vs 10/20 — 가격이 다름).
interface PositionalDrug {
  productName: string;
  unitPrice: string;        // OCR 에서 본 단가 (숫자 문자열)
  quantity: string;
  insuranceCode: string;    // 9자리가 같은 행에 있으면 즉시
  anchorY: number;          // 약품명 anchor field 의 raw Y 좌표 (px) — 정확한 위치 추적용
}
interface PositionalResult {
  drugs: PositionalDrug[];
  candidates: Array<{
    text: string;
    y: number;
    x: number;
    accepted: boolean;
    reason: string | null;
    // accepted=true 일 때만 채워지는 디버그 정보 — 회귀/오인식 행을 사용자가 직접 짚을 수 있게
    slope?: number;          // 사용된 row band slope (이 약품에 적용된 기울기)
    bandWidth?: number;      // anchor band 폭 (좁으면 globalSlope 폴백 위험 신호)
    quantity?: string;       // 매칭된 사용량
    quantityY?: number;      // 매칭된 quantity field 의 Y (anchor Y 와 비교해 한 행 거리 가늠)
    insuranceCode?: string;  // 같은 행에서 추출된 9자리 코드
  }>;
}
function extractDrugsPositionalWithDebug(rows: ClovaRow[], colMap: ColumnMap | null): PositionalResult {
  const candidates: PositionalResult["candidates"] = [];
  // colMap 없을 때라도 후보는 수집해서 사용자가 보게
  if (!colMap || colMap.productName == null || colMap.quantity == null) {
    for (const r of rows) {
      for (const f of r.fields) {
        if (!isLikelyDrug(f.inferText)) continue;
        candidates.push({
          text: f.inferText, y: fieldYCenter(f), x: fieldXCenter(f),
          accepted: false, reason: "ColumnMap 없음 (헤더 감지 실패)",
        });
      }
    }
    return { drugs: [], candidates };
  }
  const drugs: PositionalDrug[] = [];

  // 모든 fields 를 평탄화 — qty/price 검색 시 클러스터 경계 무시
  const allFields: ClovaField[] = [];
  for (const r of rows) for (const f of r.fields) allFields.push(f);

  // 처리된 약품명 fields 추적 (중복 출력 방지)
  const processed = new Set<ClovaField>();

  // 약품명 후보를 모아 Y 정렬 — Clova 클러스터링이 두 행을 합쳤어도 각 약품명 field 가
  // 자체 Y 를 가지므로 위→아래 순으로 처리 가능.
  type DrugField = { field: ClovaField; rowIdx: number; y: number };
  const drugCandidates: DrugField[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const f of row.fields) {
      if (!isLikelyDrug(f.inferText)) continue;
      const x = fieldXCenter(f);
      const y = fieldYCenter(f);
      // 헤더 위/너무 멀리 있는 후보도 우선 candidates 에 기록 (사용자가 무엇이 떨어졌는지 봄)
      if (row.avgY <= colMap.headerY) {
        candidates.push({ text: f.inferText, y, x, accepted: false, reason: "헤더 위쪽 행 (헤더보다 위)" });
        continue;
      }
      // FIX #5: X 허용오차를 컬럼 간 거리에 따라 동적으로. 좁은 표는 100px, 넓은 표는 quantity 컬럼까지의 거리 절반.
      const productNameXTol = colMap.quantity ? Math.max(150, (colMap.quantity - colMap.productName) / 2) : 250;
      const dist = Math.abs(x - colMap.productName);
      if (dist > productNameXTol) {
        candidates.push({ text: f.inferText, y, x, accepted: false, reason: `productName 컬럼 X(${Math.round(colMap.productName)})에서 ${Math.round(dist)}px 떨어짐 (${Math.round(productNameXTol)}px 초과)` });
        continue;
      }
      drugCandidates.push({ field: f, rowIdx: i, y });
    }
  }
  // Y 순서 정렬
  drugCandidates.sort((a, b) => a.y - b.y);

  // Phantom 행 제거 — 사진이 기울었을 때 Clova OCR 이 같은 약품명을 같은 시각적 행에서
  // 두 번 검출 (Y 좌표가 다르게 잡힘) → row clustering 이 한 행을 두 행으로 쪼갬.
  // 같은 약품명이 바로 인접한 Y(< 25px)에 또 등장하면 phantom 으로 판정해 제외.
  // 진료실 1·2 같이 정당하게 같은 약을 두 행에 처방한 경우는 행 간 Y 차이가 일반적으로
  // 30px 이상이므로 영향 없음.
  const PHANTOM_Y_TOLERANCE = 25;
  const dedupedCandidates: DrugField[] = [];
  for (const cand of drugCandidates) {
    const norm = cand.field.inferText.replace(/\s+/g, "").toLowerCase();
    const dup = dedupedCandidates.find((d) => {
      const dNorm = d.field.inferText.replace(/\s+/g, "").toLowerCase();
      return dNorm === norm && Math.abs(d.y - cand.y) < PHANTOM_Y_TOLERANCE;
    });
    if (dup) {
      candidates.push({
        text: cand.field.inferText,
        y: cand.y,
        x: fieldXCenter(cand.field),
        accepted: false,
        reason: `phantom 행 (Y=${Math.round(dup.y)} 와 ${Math.abs(Math.round(cand.y - dup.y))}px 차이 — 같은 행 OCR 중복 검출로 추정)`,
      });
      continue;
    }
    dedupedCandidates.push(cand);
  }

  for (const cand of dedupedCandidates) {
    if (processed.has(cand.field)) {
      candidates.push({ text: cand.field.inferText, y: cand.y, x: fieldXCenter(cand.field), accepted: false, reason: "이전 약품의 풀네임 일부로 합쳐짐" });
      continue;
    }
    processed.add(cand.field);
    const anchorY = cand.y;
    const row = rows[cand.rowIdx];

    // 같은 약품명에 대한 풀네임 만들기 — anchor Y ±18px + productName 컬럼 X 영역의 fields
    const leftBound = (colMap.insuranceCode ?? 0) + 30;
    const rightBound = Math.min(colMap.unitPrice ?? colMap.quantity, colMap.quantity) - 30;
    const productFields = allFields
      .filter((f) => {
        const fx = fieldXCenter(f);
        const fy = fieldYCenter(f);
        return Math.abs(fy - anchorY) < 18 && fx >= leftBound && fx <= rightBound;
      })
      .sort((a, b) => fieldXCenter(a) - fieldXCenter(b));
    // FIX #6: isLikelyDrug 통과한 field 는 processed 에 넣지 않음 — 인접 행이 클러스터에
    // 합쳐졌을 때 다른 약품의 anchor 가 첫 약품의 풀네임 일부로 빨려들어가 사라지던 버그 수정.
    // (단, 자기 자신 cand.field 는 이미 위에서 추가됨)
    productFields.forEach((f) => {
      if (f !== cand.field && !isLikelyDrug(f.inferText)) processed.add(f);
    });
    const productName = (productFields.length ? productFields : [cand.field])
      .map((f) => f.inferText).join(" ").trim();

    // FIX #8: 컬럼 간 거리 기반 X 허용오차 — 단가/사용량 컬럼이 200px 이내로 가까우면
    // ±100px 가 두 컬럼을 모두 덮어 cross-pollination. 인접 컬럼까지 거리의 절반을 한도로.
    function colTolerance(colX: number, ...neighbors: (number | null)[]): number {
      let minNeighborDist = Infinity;
      for (const n of neighbors) if (n != null) minNeighborDist = Math.min(minNeighborDist, Math.abs(n - colX));
      return Math.max(20, Math.min(100, minNeighborDist / 2 - 10));
    }
    const unitPriceTol = colMap.unitPrice != null ? colTolerance(colMap.unitPrice, colMap.quantity, colMap.patientCount, colMap.productName) : 100;
    const quantityTol = colMap.quantity != null ? colTolerance(colMap.quantity, colMap.unitPrice, colMap.total, colMap.productName) : 100;

    // 약품명 anchor 영역의 fields 를 모두 합친 polygon 으로 행 띠(slope-aware band) 를
    // 그리고, 각 컬럼 X 까지 slope 를 따라 띠를 연장한 expected Y 범위 안에 들어오는
    // fields 만 매칭. 사진이 기울어져 같은 행의 셀이 anchor 의 Y 와 벌어지는 케이스 보정.
    //
    // bandFromField (단일) 대신 bandFromFields (다중) 를 쓰는 이유: anchor 단일 field 가
    // 폭 80px 미만이면 local slope 추정 실패 → globalSlope 폴백인데, 헤더 slope 만으로는
    // 사진 아래쪽 행 (원근 왜곡으로 더 기울어짐) 을 못 따라간다. productFields 를 합치면
    // polygon 폭이 1.5~3 배로 늘어 local slope 가 안정 추정된다.
    const anchorBand = bandFromFields(
      productFields.length > 0 ? productFields : [cand.field],
      colMap.slope || 0
    );
    function inAnchorBand(f: ClovaField, yMargin = 6): boolean {
      if (!anchorBand) return Math.abs(fieldYCenter(f) - anchorY) <= 15;
      const fy = fieldYCenter(f);
      const dx = fieldXCenter(f) - anchorBand.anchorX;
      const expectedTop = anchorBand.top + anchorBand.slope * dx;
      const expectedBot = anchorBand.bot + anchorBand.slope * dx;
      return fy >= expectedTop - yMargin && fy <= expectedBot + yMargin;
    }

    // 사용량/단가: 같은 행 띠 안에서 컬럼 X ±tolerance 범위의 숫자 field 중 X 가장 가까운 것.
    // 매칭된 field 자체도 같이 반환 — 진단 패널에서 quantityY 노출해 anchor Y 와의 거리로
    // 다음 행 cell 잘못 잡힌 회귀 케이스를 사용자가 즉시 짚을 수 있게.
    function nearestNumberAt(colX: number | null, tol: number): { value: string; field: ClovaField | null } {
      if (colX == null) return { value: "", field: null };
      let best: ClovaField | null = null;
      let bestDist = Infinity;
      for (const f of allFields) {
        if (!inAnchorBand(f)) continue;
        if (!/\d/.test(f.inferText)) continue;
        const dist = Math.abs(fieldXCenter(f) - colX);
        if (dist > tol) continue;
        if (dist < bestDist) { best = f; bestDist = dist; }
      }
      return { value: best ? best.inferText.replace(/[^\d.]/g, "") : "", field: best };
    }
    const unitPriceMatch = nearestNumberAt(colMap.unitPrice, unitPriceTol);
    const quantityMatch = nearestNumberAt(colMap.quantity, quantityTol);
    const unitPrice = unitPriceMatch.value;
    const quantity = quantityMatch.value;

    // 9자리 보험코드: 같은 행 띠 안에서 검색
    let insuranceCode = "";
    for (const f of allFields) {
      if (!inAnchorBand(f)) continue;
      const m = f.inferText.match(/\b(\d{9})\b/);
      if (m) { insuranceCode = m[1]; break; }
    }

    // 같은 클러스터의 다른 row 정보도 사용했을 수 있으니 row 변수 자체는 더 사용 안 함
    void row;

    drugs.push({ productName, unitPrice, quantity, insuranceCode, anchorY });
    candidates.push({
      text: cand.field.inferText,
      y: anchorY,
      x: fieldXCenter(cand.field),
      accepted: true,
      reason: null,
      // 회귀/오인식 진단용 — 어느 행이 어떤 slope·매칭값으로 잡혔는지
      slope: anchorBand ? Math.round(anchorBand.slope * 10000) / 10000 : undefined,
      quantity,
      quantityY: quantityMatch.field ? Math.round(fieldYCenter(quantityMatch.field) * 10) / 10 : undefined,
      insuranceCode: insuranceCode || undefined,
    });
  }
  return { drugs, candidates };
}

// 호환 wrapper — 기존 호출처용
function extractDrugsPositional(rows: ClovaRow[], colMap: ColumnMap | null): PositionalDrug[] {
  return extractDrugsPositionalWithDebug(rows, colMap).drugs;
}

function parseDrugsFromClova(rows: ClovaRow[], colMap: ColumnMap | null): MergedDrug[] {
  if (!colMap || colMap.productName == null || colMap.quantity == null) return [];
  const drugs: MergedDrug[] = [];
  for (const row of rows) {
    if (row.avgY <= colMap.headerY) continue;

    // 1) 약품명 후보 — 행 내 fields 중 colMap.productName X 와 가까우면서
    //    한글 + 제형 어미 또는 5자 이상 영문 INN 인 텍스트
    let productField: ClovaField | null = null;
    let productDist = Infinity;
    for (const f of row.fields) {
      const fx = fieldXCenter(f);
      const dist = Math.abs(fx - colMap.productName);
      if (dist > 200) continue;
      if (!isLikelyDrug(f.inferText)) continue;
      if (dist < productDist) {
        productField = f;
        productDist = dist;
      }
    }
    if (!productField) continue;

    // 약품명 인접 fields 도 합쳐서 풀네임 만들기 (Clova 가 약품명 + 영문 + 용량 분할 했을 때)
    const productY = fieldYCenter(productField);
    const sameRowFields = row.fields
      .filter((f) => Math.abs(fieldYCenter(f) - productY) < 25)
      .sort((a, b) => fieldXCenter(a) - fieldXCenter(b));
    // 약품명 컬럼 영역에 있는 fields (X < quantity 시작)
    const productAreaFields = sameRowFields.filter((f) => {
      const fx = fieldXCenter(f);
      return fx < colMap.quantity! - 50 && fx > (colMap.insuranceCode ?? 0) + 50;
    });
    const fullProductName = productAreaFields.length > 0
      ? productAreaFields.map((f) => f.inferText).join(" ").trim()
      : productField.inferText.trim();

    // 2) 사용량 — colMap.quantity X 와 가까운 숫자 field
    const band = bandFromField(productField, colMap.slope || 0);
    if (!band) continue;
    let qty: string = "";
    let qtyDist = Infinity;
    for (const f of row.fields) {
      const fx = fieldXCenter(f);
      const fy = fieldYCenter(f);
      const xDist = Math.abs(fx - colMap.quantity);
      if (xDist > 100) continue;
      const dx = fx - band.anchorX;
      const expectedTop = band.top + band.slope * dx;
      const expectedBot = band.bot + band.slope * dx;
      if (fy < expectedTop - 6 || fy > expectedBot + 6) continue;
      if (!/\d/.test(f.inferText)) continue;
      if (xDist < qtyDist) {
        qty = f.inferText.replace(/[^\d.]/g, "");
        qtyDist = xDist;
      }
    }

    // 3) 보험코드 — 행 내 어디든 9자리 숫자가 있으면 사용
    let insuranceCode = "";
    for (const f of row.fields) {
      const m = f.inferText.match(/\b(\d{9})\b/);
      if (m) { insuranceCode = m[1]; break; }
    }

    // 4) 제약사 — 약품명 끝 또는 인접 field 에서 한글 회사명 패턴
    let companyName = "";
    const companyMatch = fullProductName.match(/([가-힣A-Z]+(?:제약|바이오|파마|약품|메디카|마더스|동구|오스틴|셀트리온|HLB|알리코))/);
    if (companyMatch) companyName = companyMatch[1];

    drugs.push({
      insuranceCode,
      productName: fullProductName,
      companyName,
      quantity: qty,
      confidence: 70, // LLM 없이 추출했으니 보수적
    });
  }
  return drugs;
}

function isLikelyDrug(name: string): boolean {
  if (!name) return false;
  const n = name.trim();
  if (n.length < 2) return false;
  // 한글 제형 어미
  if (/[정캡셀시럽주사연고크림겔패취산제환제액포]/.test(n) && /[가-힣]/.test(n)) return true;
  // 영문 INN 명 (5자 이상 영문)
  if (/[A-Za-z]{5,}/.test(n)) return true;
  // 그 외 (NH팜, 합계 등 짧은 한글) 는 제외
  return false;
}

// 표 헤더 행에서 각 컬럼의 X 중심 좌표 추출 — 이후 데이터 행에서 같은 X 영역의 값을
// 읽어 컬럼 의미별로 매핑한다. LLM 이 단가/사용량 헷갈리는 문제를 X 좌표 기반으로 우회.
export interface ColumnMap {
  insuranceCode: number | null;  // 약품코드/처방코드/보험코드 컬럼 X
  productName:   number | null;  // 약품명/처방명칭 컬럼 X
  patientCount:  number | null;  // 환자수 컬럼 X
  unitPrice:     number | null;  // 단가 컬럼 X
  quantity:      number | null;  // 사용량/총사용량/총량 컬럼 X
  total:         number | null;  // 총액/금액/송금액 컬럼 X
  headerY:       number;         // 헤더 행의 Y (이 아래 행만 데이터 행으로 간주)
  slope:         number;         // 행 기울기 (dy / dx, 사진이 비뚤어진 경우 0이 아님)
}

// 헤더 후보 키워드 — 카운트용 (느슨하게). 한 행에 3개 이상 매칭되면 헤더 행 후보.
// EMR 마다 컬럼 표기가 다르므로 일반적으로 등장하는 변형을 폭넓게 포함.
const HEADER_HIT_KEYWORDS = [
  // 약품 식별 코드
  "처방코드", "약품코드", "보험코드", "청구코드", "사용자코드", "내부코드",
  // 약품명 (한글)
  "약품명", "처방명칭", "제품명", "품명", "명칭", "처방약명",
  // 환자수 / 처방빈도
  "환자수", "환자", "처방횟수", "처방횟", "처방빈도",
  // 단가 / 단위
  "단가", "단위", "약가",
  // 수량 / 투여량
  "사용량", "총사용량", "총량", "투여량", "투약량", "처방량", "수량", "용량", "투약",
  // 회수 / 일수
  "회수", "매수", "일수", "투약일수", "일",
  // 금액
  "금액", "총액", "송금액", "총금액",
];

// OCR 오타 정규화 — 모니터 사진처럼 흐릿한 입력에서 헤더가 깨지는 케이스 대응.
// 헤더 매칭 직전에만 적용하므로 본문 약품명에는 영향 없음.
// 새 OCR 오타 패턴이 발견되면 여기에 추가.
function normalizeHeaderText(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/홍금액/g, "총금액")     // 홍←총 (모니터 사진 단골)
    .replace(/총엥|종액|총엑/g, "총액") // 액 글자 OCR 오류
    .replace(/명청|명졍/g, "명칭")     // 청·졍←칭
    .replace(/용사용당/g, "용사용량")  // 당←량
    .replace(/총사용당/g, "총사용량")
    .replace(/약풍명|약품맹/g, "약품명") // 풍←품, 맹←명
    .replace(/처방횟$/, "처방횟수")    // 행 끝에서 잘린 케이스
    .replace(/처빙|처방횟단가/g, "처방횟수단가") // 단가 결합형
    ;
}

function findColumnMap(rows: ClovaRow[]): ColumnMap | null {
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i];
    const hits = row.fields.filter((f) => {
      const norm = normalizeHeaderText(f.inferText);
      return HEADER_HIT_KEYWORDS.some((k) => norm.includes(k));
    });
    if (hits.length < 3) continue;
    // 헤더 필드들의 (X, Y) 로 행 기울기 추정 — 사진이 비뚤어졌을 때 사용
    const points = hits.map((f) => ({ x: fieldXCenter(f), y: fieldYCenter(f) })).sort((a, b) => a.x - b.x);
    const dx = points[points.length - 1].x - points[0].x;
    const dy = points[points.length - 1].y - points[0].y;
    const slope = dx > 100 ? dy / dx : 0; // dy per 1 px of dx
    const map: ColumnMap = {
      insuranceCode: null, productName: null, patientCount: null,
      unitPrice: null, quantity: null, total: null,
      headerY: row.avgY,
      slope,
    };
    // 컬럼 매핑 — 우선순위: 신뢰도 높은 키워드부터 strict 매칭.
    // "사용자코드"는 9자리 청구코드와 다른 (EMR 내부 단축 코드) 컬럼이라 insuranceCode 매핑에서 제외.
    for (const f of row.fields) {
      const x = fieldXCenter(f);
      const t = normalizeHeaderText(f.inferText);
      if (/청구코드|보험코드|약품코드|처방코드/.test(t)) map.insuranceCode = x;
      else if (/처방명칭|약품명|제품명|처방약명|품명|명칭/.test(t)) map.productName = x;
      else if (/환자수|환자/.test(t)) map.patientCount = x;
      // 단가 — '처방횟수단가' 같은 결합형도 잡되 '약가' 도 fallback 으로 인정
      else if (/단가|약가/.test(t)) map.unitPrice = x;
      // 수량 계열 — 가장 다양한 변형. '용량' 도 포함 (일부 EMR)
      else if (/총사용량|총량|사용량|투여량|투약량|처방량|^수량$|수량$|^용량$/.test(t)) map.quantity = x;
      else if (/송금액|총금액|총액|금액/.test(t)) map.total = x;
    }
    // 헤더 slope 와 데이터 행 slope 비교 — 사진이 아래로 갈수록 더 기울어지는 원근 왜곡
    // 케이스에서 헤더(표 위쪽) 만으로는 기울기를 과소 추정함. 데이터 행 slope 가 더 크면
    // 그쪽을 채택해 표 아래쪽 행 매칭도 보장.
    const dataSlope = estimateSlopeFromDrugRows(rows);
    if (Math.abs(dataSlope) > Math.abs(map.slope)) {
      map.slope = dataSlope;
    }
    // 약품명 + 사용량 (또는 수량) X 가 둘 다 있어야 의미 있음
    if (map.productName != null && map.quantity != null) return map;
  }
  return null;
}

// 헤더 매칭 실패 시 폴백 — 첫 약품 데이터 행을 찾아 컬럼 X 를 추정한다.
// 모니터 사진처럼 헤더 OCR 이 통째로 깨졌을 때 안전망.
//
// 휴리스틱:
//   1) '한글 제형 어미를 가진 약품명' 과 숫자가 같이 있는 첫 행 = 첫 데이터 행
//   2) productName X = 그 행의 첫 한글 약품명 field X
//   3) quantity X = productName 보다 오른쪽의 첫 숫자 field X (가장 가까운 것)
//   4) headerY = 그 행 직전의 행 Y (또는 행 자체보다 1px 위)
//
// 한계: 컬럼 순서가 [약품명·환자수·단가·사용량·총액] 인 EMR 에선 quantity 가 환자수로 잘못
// 매핑될 수 있다. 그래도 헤더 매칭이 통째로 실패해 후보 0건이 되는 것보단 일부 정답.
// 사용자가 수동 검수에서 잡는 것을 전제로 한 보수적 폴백.
function findColumnMapByDataRow(rows: ClovaRow[]): ColumnMap | null {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const drugFields = row.fields.filter((f) => isLikelyDrug(f.inferText));
    if (drugFields.length === 0) continue;
    const numberFields = row.fields
      .filter((f) => /\d/.test(f.inferText) && /^\d[\d.,]*$/.test(f.inferText.trim()))
      .filter((f) => parseInt(f.inferText.replace(/\D/g, ""), 10) >= 1);
    if (numberFields.length < 1) continue;

    // 첫 한글 약품명 (X 가 작은 것)
    const drugField = drugFields.sort((a, b) => fieldXCenter(a) - fieldXCenter(b))[0];
    const drugX = fieldXCenter(drugField);
    // 약품명 오른쪽의 첫 숫자
    const rightNumbers = numberFields
      .filter((f) => fieldXCenter(f) > drugX + 30)
      .sort((a, b) => fieldXCenter(a) - fieldXCenter(b));
    if (rightNumbers.length === 0) continue;
    const quantityX = fieldXCenter(rightNumbers[0]);

    // 헤더 Y — 데이터 행 직전 행이 있으면 그 Y, 없으면 데이터 행보다 1 위로
    const headerY = i > 0 ? rows[i - 1].avgY : row.avgY - 1;

    return {
      insuranceCode: null,    // 9자리 정규식이 행 단위로 처리
      productName: drugX,
      patientCount: null,
      unitPrice: null,
      quantity: quantityX,
      total: null,
      headerY,
      // 사진이 기울어진 케이스 — 데이터 행들의 실제 기울기로 추정.
      // 0 이면 평평한 사진. positional 추출의 slope-aware band 와 짝.
      slope: estimateSlopeFromDrugRows(rows),
    };
  }
  return null;
}

// 행에서 columnX 에 가장 가까운 텍스트 필드의 값을 반환. tolerance 안에 없으면 ""
function valueAtColumn(row: ClovaRow, columnX: number, tolerance = 120): string {
  let nearest: ClovaField | null = null;
  let bestDist = Infinity;
  for (const f of row.fields) {
    const dist = Math.abs(fieldXCenter(f) - columnX);
    if (dist < tolerance && dist < bestDist) {
      nearest = f;
      bestDist = dist;
    }
  }
  return nearest?.inferText ?? "";
}

// productName 텍스트가 들어있는 Clova field 의 Y 좌표를 기준선으로 잡고, 같은 Y 라인의
// quantity 컬럼 X 위치에 있는 숫자 필드를 반환. 행 클러스터링이 어긋나도 영향받지 않음.
// 반환: { quantity, rowY } 또는 null
interface ExtractResult {
  quantity: string | null;
  rowY: number;
  band: RowBand;
  qtyField: ClovaField | null;
}
function extractByColumnMap(
  productName: string,
  rows: ClovaRow[],
  colMap: ColumnMap
): ExtractResult | null {
  if (!productName || !colMap.quantity) return null;
  const parsed = parseDrugName(productName);
  const koreanKey = parsed.korean.replace(/\s+/g, "").toLowerCase();
  const doseKey = parsed.dose.replace(/\s+/g, "").toLowerCase();
  if (koreanKey.length < 2) return null;

  // 1) 같은 한글 약품명을 가진 행이 여러 개일 수 있음(다른 용량 변형). 한글 prefix +
  //    dose 가 모두 들어있는 행만 선택해 용량 변형을 구분.
  let targetRow: ClovaRow | null = null;
  for (const row of rows) {
    if (row.avgY <= colMap.headerY) continue;
    const rowText = row.text.replace(/\s+/g, "").toLowerCase();
    if (!rowText.includes(koreanKey)) continue;
    if (doseKey && !rowText.includes(doseKey)) continue;
    targetRow = row;
    break;
  }
  if (!targetRow) return null;

  // 약품명 텍스트가 들어있는 raw field 를 anchor 로. 그 field 의 boundingPoly 4 vertex
  // 자체가 행의 위/아래 가장자리 + 행의 실제 기울기를 알려준다 (사용자 지적 그대로).
  let anchorField: ClovaField | null = null;
  for (const f of targetRow.fields) {
    const t = f.inferText.replace(/\s+/g, "").toLowerCase();
    if (!t.includes(koreanKey)) continue;
    anchorField = f;
    break;
  }
  if (!anchorField) return null;

  const band = bandFromField(anchorField, colMap.slope || 0);
  if (!band) return null;

  // 2) 후보 field 가 anchor 의 위·아래 가장자리 라인 사이에 들어오면 같은 행으로 인정.
  //    각 라인은 X 에 따라 (anchor 의 자체 slope 또는 globalSlope 만큼) 기울어져 연장됨.
  //    descender / 점·괄호 등 약간의 비어져 나오는 글자 보정용으로 ±6px 여유.
  const yMargin = 6;
  let qtyField: ClovaField | null = null;
  let qtyDist = Infinity;
  for (const row of rows) {
    for (const f of row.fields) {
      const fx = fieldXCenter(f);
      const fy = fieldYCenter(f);
      const xDist = Math.abs(fx - colMap.quantity);
      if (xDist > 100) continue;
      const dx = fx - band.anchorX;
      const expectedTop = band.top + band.slope * dx;
      const expectedBot = band.bot + band.slope * dx;
      if (fy < expectedTop - yMargin || fy > expectedBot + yMargin) continue;
      if (!/\d/.test(f.inferText)) continue;
      if (xDist < qtyDist) {
        qtyField = f;
        qtyDist = xDist;
      }
    }
  }
  if (!qtyField) return { quantity: null, rowY: band.centerY, band, qtyField: null };

  const cleaned = qtyField.inferText.replace(/[^\d.]/g, "");
  return { quantity: cleaned || null, rowY: band.centerY, band, qtyField };
}

// anchor field 의 boundingPoly 로부터 행 띠(top, bot, anchorX, slope) 추출.
// slope: 폭이 80px 이상이면 anchor 자체 top edge 의 dy/dx 사용 (per-row local slope).
//        그보다 좁으면 글로벌 slope 를 fallback.
interface RowBand {
  top: number;
  bot: number;
  centerY: number;
  anchorX: number;
  slope: number;
}
function bandFromField(f: ClovaField, globalSlope: number): RowBand | null {
  const vs = f.boundingPoly?.vertices ?? [];
  if (vs.length < 3) return null;
  const ys = vs.map((v) => v.y);
  const xs = vs.map((v) => v.x);
  const top = Math.min(...ys);
  const bot = Math.max(...ys);
  const anchorX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (top + bot) / 2;

  // local slope: 4-vertex 인 경우 top-left·top-right 두 점으로
  let slope = globalSlope;
  if (vs.length === 4) {
    const sortedY = [...vs].sort((a, b) => a.y - b.y);
    const topPair = sortedY.slice(0, 2).sort((a, b) => a.x - b.x);
    const dx = topPair[1].x - topPair[0].x;
    const dy = topPair[1].y - topPair[0].y;
    if (dx > 80 && Math.abs(dy / dx) < 0.3) {
      slope = dy / dx;
    }
  }

  return { top, bot, centerY, anchorX, slope };
}

// bandFromField 의 다중-field 버전. 같은 행에 속하는 인접 fields 들 (예: 약품명 + 영문 INN
// + 용량 토큰) 의 vertices 를 모두 합쳐 polygon 을 그리고 그 위쪽 가장자리로 slope 추정.
//
// 단일 field 폭이 80px 미만이면 bandFromField 가 globalSlope 로 폴백하는데, 모니터 사진
// 처럼 globalSlope 가 부정확한 케이스에선 같은 행 매칭이 깨짐. 약품명 컬럼 영역의 fields
// 를 모으면 polygon 폭이 1.5~3 배 길어져 local slope 가 안정적으로 추정된다.
function bandFromFields(fs: ClovaField[], globalSlope: number): RowBand | null {
  if (fs.length === 0) return null;
  if (fs.length === 1) return bandFromField(fs[0], globalSlope);
  const points: { x: number; y: number }[] = [];
  for (const f of fs) {
    for (const v of f.boundingPoly?.vertices ?? []) {
      points.push({ x: v.x, y: v.y });
    }
  }
  if (points.length < 3) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const top = Math.min(...ys);
  const bot = Math.max(...ys);
  const anchorX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (top + bot) / 2;

  // local slope: 모든 vertex 중 위쪽 절반의 점들에서 가장 왼쪽·오른쪽 두 점으로 추정.
  // 결합 polygon 이라 폭이 길어졌으니 임계값을 60px 로 완화 (단일 field 80px 보다 낮음).
  let slope = globalSlope;
  const sorted = [...points].sort((a, b) => a.y - b.y);
  const topHalf = sorted.slice(0, Math.max(2, Math.ceil(sorted.length / 2)));
  const left = topHalf.reduce((a, b) => (a.x < b.x ? a : b));
  const right = topHalf.reduce((a, b) => (a.x > b.x ? a : b));
  const dx = right.x - left.x;
  if (dx > 60) {
    const dy = right.y - left.y;
    const candidate = dy / dx;
    if (Math.abs(candidate) < 0.3) slope = candidate;
  }

  return { top, bot, centerY, anchorX, slope };
}

// 호환용 wrapper — 기존 호출처에서 사용
function quantityFromColumnMap(
  productName: string,
  rows: ClovaRow[],
  colMap: ColumnMap
): string | null {
  const r = extractByColumnMap(productName, rows, colMap);
  return r?.quantity ?? null;
}

// 거래처 직전 PrescriptionReport 의 ocrData.columnTemplate 가져오기.
// 같은 거래처라도 EMR 이 다르면 (예: 늘편한내과 종이/모니터) 다른 ColumnTemplate 가 필요하므로,
// 가장 최근 보고서의 vendor 와 현재 vendor 가 호환될 때만 캐시를 적용한다.
//   - 호환 시: { template, savedVendor, rejectReason: null }
//   - 비호환 시: { template: null, savedVendor: 저장된 vendor, rejectReason: "..." }
//   - 데이터 없음: { template: null, savedVendor: null, rejectReason: "..." }
//
// FUTURE: 향후 vendor 별로 분기된 캐시를 갖고 싶다면 ocrData.columnTemplatesByVendor 같은
// dict 를 만들어 여러 EMR 의 템플릿을 동시에 보관할 수 있다 (현재는 LIFO 1슬롯).
async function fetchCachedColumnTemplate(
  clientId: string,
  currentVendor: EmrVendor
): Promise<{ template: ColumnTemplate | null; savedVendor: EmrVendor | null; rejectReason: string | null }> {
  const recent = await prisma.prescriptionReport.findFirst({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    select: { ocrData: true },
  });
  if (!recent?.ocrData || typeof recent.ocrData !== "object") {
    return { template: null, savedVendor: null, rejectReason: "이 거래처 이전 업로드 없음" };
  }
  const t = (recent.ocrData as Record<string, unknown>).columnTemplate;
  if (!t || typeof t !== "object") {
    return { template: null, savedVendor: null, rejectReason: "이전 업로드에 columnTemplate 미저장" };
  }
  const tt = t as Record<string, unknown>;
  // 핵심 필드 검증
  if (typeof tt.productName !== "number" || typeof tt.quantity !== "number") {
    return { template: null, savedVendor: null, rejectReason: "캐시된 템플릿 필드 누락" };
  }

  const savedVendor = (typeof tt.vendor === "string" ? tt.vendor : null) as EmrVendor | null;
  // vendor 비호환 — 같은 거래처가 EMR 두 개 쓰는 케이스 보호
  if (!isVendorCompatible(savedVendor, currentVendor)) {
    return {
      template: null,
      savedVendor,
      rejectReason: `vendor mismatch (저장됨: ${savedVendor ?? "?"} → 현재: ${currentVendor})`,
    };
  }

  const savedCaptureType = (typeof tt.captureType === "string" ? tt.captureType : undefined) as CaptureType | undefined;
  const template: ColumnTemplate = {
    insuranceCode: typeof tt.insuranceCode === "number" ? tt.insuranceCode : null,
    productName: tt.productName,
    patientCount: typeof tt.patientCount === "number" ? tt.patientCount : null,
    unitPrice: typeof tt.unitPrice === "number" ? tt.unitPrice : null,
    quantity: tt.quantity,
    total: typeof tt.total === "number" ? tt.total : null,
    detectedAt: String(tt.detectedAt ?? ""),
    source: "cached",
    vendor: savedVendor ?? undefined,
    captureType: savedCaptureType,
  };
  return { template, savedVendor, rejectReason: null };
}

// 캐시된 비율 템플릿 → 현재 이미지의 ColumnMap (절대 X 좌표) 로 환산
function columnMapFromTemplate(
  tmpl: ColumnTemplate,
  imageWidth: number,
  rows: ClovaRow[]
): ColumnMap | null {
  if (!imageWidth) return null;
  const scale = (ratio: number | null) =>
    ratio == null ? null : Math.round(ratio * imageWidth);
  // 헤더 Y는 캐시에 없지만, 데이터 행을 자르기 위한 기준은 필요. 첫 약품 같은 행을
  // 데이터 시작점으로 보고, 그 위는 헤더 영역으로 간주.
  const firstDrugRow = rows.find((r) => r.fields.some((f) => isLikelyDrug(f.inferText)));
  const headerY = firstDrugRow ? firstDrugRow.avgY - 1 : 0;
  // 캐시된 템플릿엔 slope 가 없으므로 현재 이미지의 약품명 fields 로 즉석 추정.
  // 같은 X 컬럼(약품명)에 있는 fields 만으로는 slope 계산이 안 되므로(수직선),
  // 헤더가 보이지 않으면 0 으로 둔다 (사진이 평평하다고 가정).
  return {
    insuranceCode: scale(tmpl.insuranceCode),
    productName: scale(tmpl.productName),
    patientCount: scale(tmpl.patientCount),
    unitPrice: scale(tmpl.unitPrice),
    quantity: scale(tmpl.quantity),
    total: scale(tmpl.total),
    headerY,
    slope: estimateSlopeFromDrugRows(rows),
  };
}

// 같은 행 안에 있는 (다양한 X 의) 필드들을 모아 slope 추정. 헤더가 안 잡혔을 때 fallback.
// 임의의 약품명 field 와 그 행에서 X 가 가장 먼 다른 field 의 (dx, dy) 평균.
function estimateSlopeFromDrugRows(rows: ClovaRow[]): number {
  const samples: number[] = [];
  for (const row of rows) {
    if (row.fields.length < 3) continue;
    const sorted = [...row.fields].sort((a, b) => fieldXCenter(a) - fieldXCenter(b));
    const left = sorted[0];
    const right = sorted[sorted.length - 1];
    const dx = fieldXCenter(right) - fieldXCenter(left);
    if (dx < 200) continue;
    const dy = fieldYCenter(right) - fieldYCenter(left);
    samples.push(dy / dx);
    // 5개 limit 제거 — 표 전체 행을 봐야 사진 아래쪽 (원근 왜곡으로 더 기울어진) 행의
    // 기울기까지 median 에 반영된다. 위 5개만 보면 표 위쪽 평탄 영역의 작은 slope 만 잡혀
    // 아래쪽 행 매칭이 깨짐.
  }
  if (samples.length === 0) return 0;
  // 중앙값 (이상치 제거)
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

// ColumnMap → ColumnTemplate (X / imageWidth 비율 로 정규화).
// vendor / captureType 을 같이 박아 저장 시 호환성 체크용 메타로 보존한다.
function buildColumnTemplate(
  map: ColumnMap,
  imageWidth: number,
  source: "auto" | "cached",
  vendor: EmrVendor,
  captureType: CaptureType
): ColumnTemplate | null {
  if (!imageWidth) return null;
  const ratio = (x: number | null) => (x == null ? null : Math.round((x / imageWidth) * 10000) / 10000);
  if (map.productName == null || map.quantity == null) return null;
  return {
    insuranceCode: ratio(map.insuranceCode),
    productName: ratio(map.productName),
    patientCount: ratio(map.patientCount),
    unitPrice: ratio(map.unitPrice),
    quantity: ratio(map.quantity),
    total: ratio(map.total),
    detectedAt: new Date().toISOString(),
    source,
    vendor,
    captureType,
  };
}

// 약품을 행 클러스터에 매칭해 Y% 반환 — 행 단위 텍스트로 검색하므로 OCR 분할에 견고
function locateRowInClova(
  item: { insuranceCode: string; productName: string },
  rows: ClovaRow[],
  imageHeight: number
): number | null {
  if (!rows.length || !imageHeight) return null;
  const code = item.insuranceCode.replace(/\D/g, "");
  const parsed = parseDrugName(item.productName);
  const koreanKey = parsed.korean.replace(/\s+/g, "").toLowerCase();
  const doseKey = parsed.dose.replace(/\s+/g, "").toLowerCase();
  for (const r of rows) {
    const t = r.text.replace(/\s+/g, "").toLowerCase();
    let matched = false;
    if (code.length === 9 && t.includes(code)) {
      matched = true;
    } else if (koreanKey.length >= 2 && t.includes(koreanKey)) {
      // dose 가 있으면 dose 도 일치해야 같은 row 로 판정 (10/10 vs 10/20 구분)
      matched = !doseKey || t.includes(doseKey);
    }
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
    // Vision 단계 — 이미지에서 직접 약품 추출. flash-lite 보다 정확한 pro 사용.
    // 비용: lite 의 ~12배 (페이지당 ₩0.2 → ₩2) 이지만 한국어 정형 문서
    // 정확도가 90% → 95% 수준으로 향상.
    model: "gemini-2.5-pro",
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
  priceHint?: number;   // OCR 에서 본 단가 — matchMasterByNameAndPrice 가 dose 변형 구분하는 키
  anchorYRaw?: number;  // positional 추출 시 약품명 field 의 raw Y 좌표 (px). 노란 띠 정확한 위치용.
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
  commissionRate: number | null;
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
    select: { id: true, insuranceCode: true, productName: true, companyName: true, price: true, commissionRate: true },
  });
  for (const r of rows) {
    if (r.insuranceCode) map.set(r.insuranceCode, r);
  }
  return map;
}

// 사용자 제안 매칭 — 이름 + OCR 에서 본 단가 로 마스터에서 정확한 row 픽.
// 같은 약품의 dose 변형(10/10 vs 10/20) 은 단가가 달라서 단가 일치로 단번에 구분.
async function matchMasterByNameAndPrice(
  productName: string,
  unitPriceRaw: string
): Promise<MasterRow | null> {
  const parsed = parseDrugName(productName);
  if (parsed.korean.length < 2) return null;
  const price = parseInt(unitPriceRaw.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(price) || price <= 0) return null;

  // 1차: 한글 이름 포함 + 가격 정확 일치
  const exactPrice = await prisma.medication.findMany({
    where: {
      productName: { contains: parsed.korean, mode: "insensitive" },
      price,
    },
    select: { id: true, insuranceCode: true, productName: true, companyName: true, price: true, commissionRate: true },
    take: 5,
  });
  if (exactPrice.length === 1) return exactPrice[0];
  if (exactPrice.length > 1) {
    // dose 토큰까지 일치하는 것 우선
    const withDose = parsed.dose
      ? exactPrice.find((r: MasterRow) => normalizeForDose(r.productName).includes(normalizeForDose(parsed.dose)))
      : null;
    return withDose ?? exactPrice[0];
  }

  // 2차: 가격 ±5% 이내 (소폭 변동 흡수)
  const priceLow = Math.floor(price * 0.95);
  const priceHigh = Math.ceil(price * 1.05);
  const nearPrice = await prisma.medication.findMany({
    where: {
      productName: { contains: parsed.korean, mode: "insensitive" },
      price: { gte: priceLow, lte: priceHigh },
    },
    select: { id: true, insuranceCode: true, productName: true, companyName: true, price: true, commissionRate: true },
    take: 5,
  });
  if (nearPrice.length > 0) {
    const withDose = parsed.dose
      ? nearPrice.find((r: MasterRow) => normalizeForDose(r.productName).includes(normalizeForDose(parsed.dose)))
      : null;
    return withDose ?? nearPrice[0];
  }

  return null;
}

async function matchMedication(
  item: MergedDrug,
  masterByCode: Map<string, MasterRow>
): Promise<{
  insuranceCode: string;
  productName: string;
  companyName: string;
  unitPrice: number | null;
  commissionRate: number | null;
  matchedMedicationId: string | null;
  matchConfidence: number;
}> {
  // 0차: priceHint (OCR 에서 본 단가) 가 있으면 이름 + 가격으로 정확한 마스터 row 찾기
  // 같은 약품의 dose 변형(로수듀오 10/10 vs 10/20) 은 가격이 달라 한 번에 정확히 구분.
  if (item.priceHint && item.productName) {
    const m = await matchMasterByNameAndPrice(item.productName, String(item.priceHint));
    if (m) {
      return {
        insuranceCode: m.insuranceCode ?? item.insuranceCode,
        productName: m.productName,
        companyName: m.companyName,
        unitPrice: m.price,
        commissionRate: m.commissionRate,
        matchedMedicationId: m.id,
        matchConfidence: 99,
      };
    }
  }

  const code = item.insuranceCode.replace(/\D/g, "");
  if (code.length === 9 && masterByCode.has(code)) {
    const m = masterByCode.get(code)!;
    return {
      insuranceCode: code,
      productName: m.productName,
      companyName: m.companyName,
      unitPrice: m.price,
      commissionRate: m.commissionRate,
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
      select: { id: true, insuranceCode: true, productName: true, companyName: true, price: true, commissionRate: true },
      take: 20,
    });
    if (rows.length === 0) return null;
    // 용량 필터 — dose 가 있으면 반드시 매칭. 없으면 빈 결과 반환 (다른 용량 변형으로
    // 잘못 떨어지는 것 방지: 로수듀오 10/20 이 마스터에 없을 때 10/10 으로 가짜 매칭 X)
    if (requireDose && doseToken) {
      const filtered = rows.filter((r: MasterRow) => normalizeForDose(r.productName).includes(normalizeForDose(doseToken)));
      if (filtered.length === 0) return null;
      const exact = filtered.find((r: MasterRow) => r.productName === item.productName);
      return { row: exact ?? filtered[0], exact: !!exact };
    }
    const exact = rows.find((r: MasterRow) => r.productName === item.productName);
    return { row: exact ?? rows[0], exact: !!exact };
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
      commissionRate: r.row.commissionRate,
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
      commissionRate: r.row.commissionRate,
      matchedMedicationId: r.row.id,
      matchConfidence: r.exact ? 95 : 85,
    };
  }

  return {
    insuranceCode: item.insuranceCode,
    productName: item.productName,
    companyName: item.companyName,
    unitPrice: null,
    commissionRate: null,
    matchedMedicationId: null,
    matchConfidence: 0,
  };
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

// "로수듀오정(rosuva/ezt10/20)HLB제약" 또는 "103 아라펜정tramadol/AAP:..." 같은
// OCR 결과에서 한글 약품명과 용량을 분리. positional 추출 시 productName 영역에
// 처방코드 (103 / 103+ / 205.. 등) 가 같이 들어올 수 있으므로, 한글 prefix 는 문자열
// 어디서든 (시작이 아니라도) 찾는다.
function parseDrugName(s: string): { korean: string; dose: string } {
  if (!s) return { korean: "", dose: "" };
  // 한글 + 한글 사이 공백 허용 + 제형 어미 우선. 처방코드 ("103 ", "205.. " 등) 는 무시
  // 하고 첫 한글 시퀀스부터 매칭. 제형으로 끝나면 우선 채택, 아니면 한글-only fallback.
  const withSuffix = s.match(/([가-힣][가-힣\s]*(?:정|캡슐|캅셀|시럽|주사액|주사|연고|크림|겔|패취|포|산제|환제|액|주|에스|서방정|장용정))/);
  const fallback = !withSuffix ? s.match(/([가-힣][가-힣\s]+)/) : null;
  const korean = (withSuffix?.[1] ?? fallback?.[1] ?? "").replace(/\s+/g, "").trim();
  // 용량: 처방코드의 숫자가 아니라 약품명 뒤의 dose 패턴 우선. 한글 끝난 위치부터 검색.
  let doseSearchFrom = 0;
  if (withSuffix?.[1]) {
    const idx = s.indexOf(withSuffix[1]);
    if (idx >= 0) doseSearchFrom = idx + withSuffix[1].length;
  }
  const tail = s.slice(doseSearchFrom);
  const doseMatch = tail.match(/(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/)
    ?? s.match(/(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/);
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
