import { GoogleGenAI, Type } from "@google/genai";

export interface RxDrugRow {
  name: string;
  code: string;          // 보험코드 9자리. 없으면 ""
  // 행별 제약사 — 사진 표에 제약사 컬럼이 있으면 Gemini 가 행마다 추출.
  // 한 사진에 여러 제약사 약품이 섞인 경우 (실제로 흔함) 행별로 분리 가능.
  // 표에 컬럼 없으면 "" — 마스터 매칭이 채워줌.
  companyName: string;
  // 숫자 셀 규칙:
  //   - 컬럼이 아예 없음 → 0 (해당없음)
  //   - 컬럼은 있으나 흐림/반사/잘림으로 "판독 불가" → null  (추정값 절대 금지)
  // null 이 하나라도 있는 행은 검수에서 "판독 불가(unreadable)" 로 분류됨.
  quantity: number | null;      // 총사용량. 소수 허용 (시럽 등)
  prescriptions: number; // 처방횟수
  unitPrice: number | null;     // 단가. 없는 컬럼이면 0, 못 읽으면 null
  totalPrice: number | null;    // 총금액. 없는 컬럼이면 0, 못 읽으면 null
  category: string;      // 자유 형식 분류 "만성질환/고혈압" 등
  efficacy: string;      // 짧은 효능 한 줄
  // bbox: 사진 내 행 위치 [x1, y1, x2, y2] 비율 (0~1).
  // 검수 페이지에서 표 행 focus 시 사진 위에 노란 highlight overlay + 자동 스크롤용.
  // Gemini 의 spatial understanding 활용. 못 잡으면 [0,0,0,0].
  bbox: [number, number, number, number];
  // qtyBbox: 그 행의 "수량(총사용량) 숫자"가 차지하는 최소 영역 [x1,y1,x2,y2] 비율 (0~1).
  // 실무자는 수량만 입력하므로 하이라이트의 진짜 기준점. 사진이 기울어도 수량 칸을 정확히 가리킨다.
  // 수량이 판독 불가(null)거나 위치를 못 잡으면 null.
  qtyBbox: [number, number, number, number] | null;
}

export interface RxStatsSummary {
  drugCount: number;
  totalPrescriptions: number;
  totalQuantity: number;
  totalAmountWon: number;
}

export interface RxExtractResult {
  pharma: string;        // "경동"
  period: string;        // "YYYY-MM" 정규화 결과 (실패 시 "")
  periodRaw: string;     // 모델 원본 응답 ("2026년 4월" 등)
  hospital: string;
  summary: RxStatsSummary;
  drugs: RxDrugRow[];
}

export interface RxExtractDebug {
  rawText: string;
  model: GeminiRxModel;
  durationMs: number;
}

// 2026-05 GA. 3.1 Pro 보다 코딩·추론 우위, 4배 빠름, 비용 저렴.
// 단일 모델 — 별도 Pro 폴백 불필요 (다운그레이드가 됨).
export type GeminiRxModel = "gemini-3.5-flash";

const DEFAULT_MODEL: GeminiRxModel = "gemini-3.5-flash";

const DRUG_ITEM_SCHEMA = {
  type: Type.OBJECT,
  required: ["name", "code", "companyName", "quantity", "prescriptions", "unitPrice", "totalPrice", "category", "efficacy", "bbox", "qtyBbox"],
  properties: {
    name: { type: Type.STRING, description: "약품명 (한글+영문 그대로, 용량/제형 포함)" },
    code: { type: Type.STRING, description: "보험코드 9자리 숫자. 모르면 빈 문자열." },
    companyName: {
      type: Type.STRING,
      description: "이 약품 행의 제약사명. 표에 제약사 컬럼이 있으면 그 값을 그대로 (예: '한미약품', '대원제약'). 컬럼 없으면 빈 문자열.",
    },
    quantity: { type: Type.NUMBER, nullable: true, description: "총사용량 컬럼 값. 소수 허용. 컬럼 없으면 0, 값이 있으나 판독 불가면 null (추정 금지)." },
    prescriptions: { type: Type.INTEGER, description: "처방횟수 컬럼 값." },
    unitPrice: { type: Type.NUMBER, nullable: true, description: "단가(원). 콤마 제거한 순수 숫자. 컬럼 없으면 0, 값이 있으나 판독 불가면 null (추정 금지)." },
    totalPrice: { type: Type.NUMBER, nullable: true, description: "총금액(원). 콤마 제거한 순수 숫자. 컬럼 없으면 0, 값이 있으나 판독 불가면 null (추정 금지)." },
    category: {
      type: Type.STRING,
      description: "약품을 자유 형식으로 분류. 예: '만성질환/고혈압', '만성질환/고지혈증', '근골격/통풍', '소화기/PPI'. enum 강요 안 함.",
    },
    efficacy: {
      type: Type.STRING,
      description: "짧은 효능 한 줄. 예: '혈전 생성 예방 (항혈소판제)'. 추측 금지 — 잘 모르는 약품이면 빈 문자열.",
    },
    bbox: {
      type: Type.ARRAY,
      description: "이 약품 행의 사진 내 위치를 비율(0~1) 4개 숫자로: [x1, y1, x2, y2]. 사진 좌상단이 (0,0), 우하단이 (1,1). 약품명 행 전체를 감싸는 사각형. 못 잡으면 [0,0,0,0].",
      items: { type: Type.NUMBER },
    },
    qtyBbox: {
      type: Type.ARRAY,
      nullable: true,
      description: "이 행의 '수량(총사용량)' 숫자가 사진에서 차지하는 최소 영역을 비율(0~1) 4개 숫자로: [x1, y1, x2, y2]. 행 전체가 아니라 수량 숫자 셀만 딱 감싸는 작은 사각형. 사진이 기울어도 그 숫자 위치를 정확히 가리킬 것. 수량을 판독 못 했거나(quantity=null) 위치를 못 잡으면 null.",
      items: { type: Type.NUMBER },
    },
  },
};

const SCHEMA = {
  type: Type.OBJECT,
  required: ["pharma", "period", "hospital", "summary", "drugs"],
  properties: {
    pharma: { type: Type.STRING, description: "제약사명 (예: '경동', '한미'). 모르면 빈 문자열." },
    period: {
      type: Type.STRING,
      description: "통계 기간. 반드시 YYYY-MM 형식 (예: '2026-04'). 사진에 '2026년 4월' 처럼 나와 있어도 YYYY-MM 으로 변환해서 응답.",
    },
    hospital: { type: Type.STRING, description: "병원/의원 이름. 사진에 없으면 빈 문자열." },
    summary: {
      type: Type.OBJECT,
      required: ["drugCount", "totalPrescriptions", "totalQuantity", "totalAmountWon"],
      properties: {
        drugCount: { type: Type.INTEGER, description: "약품 종류 수 (행 개수)." },
        totalPrescriptions: { type: Type.INTEGER, description: "총 처방횟수." },
        totalQuantity: { type: Type.NUMBER, description: "총 사용량 합계. 소수 허용." },
        totalAmountWon: { type: Type.INTEGER, description: "총 금액(원). 콤마 제거한 순수 정수." },
      },
    },
    drugs: {
      type: Type.ARRAY,
      description: "약품별 행 리스트. 합계행/카테고리 헤더행 제외 — 진짜 약품 행만.",
      items: DRUG_ITEM_SCHEMA,
    },
  },
};

function buildPrompt(): string {
  return [
    "이 사진은 한국 EMR 처방 통계 표 화면입니다. 비스듬히 찍히거나 모니터 반사 등으로 보일 수 있어요.",
    "사진을 사람처럼 보고 다음을 추출하세요. 위치 기반 OCR 아니라 멀티모달 비전으로 표 구조를 직접 이해해서 행 단위로 정리.",
    "",
    "추출 규칙:",
    "1) 상단/제목/검색조건 영역에서 제약사명(전체 통계의 대표값)·통계기간·병원명을 찾는다. 한 사진에 여러 제약사가 섞인 경우 가장 행이 많은 제약사를 pharma 에 (또는 빈 문자열).",
    "2) 표의 합계 영역(약품건수/처방횟수/총사용량/총금액) 4개 숫자를 summary 에.",
    "3) 표 본문은 한 행 = 한 약품. 합계행이나 카테고리 헤더행은 제외. 같은 약품명이 두 번 나오면 둘 다 별도 항목으로 보존.",
    "3-1) **각 약품 행마다 companyName 필드에 그 행의 제약사명을 적는다.** 표에 제약사 컬럼이 있으면 그 값 그대로. 컬럼 없거나 빈 셀이면 빈 문자열. 한 사진에 여러 제약사가 섞이는 경우(EMR 처방통계에서 흔함) 각 행이 자신의 제약사를 갖도록.",
    "4) 각 약품에 대해 medicine 지식 기반으로 category(자유 형식, 예: '만성질환/고혈압')와 efficacy(짧은 효능)를 부여.",
    "5) 잘 모르는 약품은 category='기타', efficacy='' 로. 추측 환각 금지.",
    "6) 모든 숫자는 콤마 제거한 순수 숫자.",
    "6-1) **판독 불가 셀은 추측하지 말고 null 을 내라.** 셀 규칙을 엄격히 구분:",
    "     · 표에 그 컬럼이 아예 없다 (예: 단가/금액 열이 없는 EMR) → 0.",
    "     · 컬럼은 있는데 흐림·반사·잘림·손가림으로 숫자를 확신할 수 없다 → null. 절대 비슷한 값으로 채우지 말 것.",
    "     · 이 규칙은 quantity(수량)·unitPrice(단가)·totalPrice(금액) 에 적용. 확실히 읽은 값만 숫자로.",
    "7) period 는 반드시 YYYY-MM 형식 (예: '2026-04'). 사진에 '2026년 4월' 로 보여도 변환.",
    "8) **각 약품 행의 사진 내 위치 bbox**: [x1, y1, x2, y2] 비율 (0~1). 사진 좌상단이 (0,0), 우하단이 (1,1). 그 약품 행 전체(왼쪽 보험코드부터 오른쪽 금액 끝까지)를 감싸는 사각형. 못 잡으면 [0,0,0,0].",
    "8-1) **각 약품 행의 qtyBbox**: 그 행의 '수량(총사용량)' 숫자가 사진에서 차지하는 최소 영역 [x1, y1, x2, y2] 비율 (0~1). 행 전체가 아니라 그 수량 숫자 셀만 딱 감싸는 작은 사각형. 실무자가 실제로 입력하는 값이 수량뿐이라, 사진이 기울어도 이 좌표가 수량 칸을 정확히 가리키게 하는 것이 핵심. 수량을 판독 못 했거나(quantity=null) 위치를 못 잡으면 qtyBbox=null.",
    "",
    "응답은 지정된 JSON 스키마만. 자유 텍스트 금지.",
  ].join("\n");
}

function parseJsonLoose(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fallthrough */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.-]/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toInt(v: unknown): number {
  const n = toNum(v);
  return Math.max(0, Math.floor(n));
}

// 숫자 셀 파싱 — Gemini 가 판독 불가로 null 을 낸 셀은 null 을 그대로 보존한다 (추정값 금지).
// null/undefined → null.  빈 문자열 / 숫자 없는 문자열 → null.  그 외 → 숫자.
function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.-]/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// "2026-04" / "2026.04" / "2026년 4월" / "Apr 2026" 등을 YYYY-MM 으로 정규화.
// 실패 시 빈 문자열 반환 — 원본은 periodRaw 에 보존됨.
function normalizePeriod(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  // 이미 YYYY-MM
  let m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  // YYYY.MM, YYYY/MM
  m = s.match(/(\d{4})[./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  // YYYY년 MM월
  m = s.match(/(\d{4}).*?(\d{1,2})\s*월/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  // 영문월
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  m = s.match(/([A-Za-z]{3,9})\s+(\d{4})/);
  if (m) {
    const mm = months[m[1].slice(0, 3).toLowerCase()];
    if (mm) return `${m[2]}-${mm}`;
  }
  return "";
}

function normalizeDrug(d: Record<string, unknown>): RxDrugRow {
  // bbox 정규화: [x1, y1, x2, y2] 4개 number, 모두 0~1 사이로 clamp. 누락/형식 오류면 [0,0,0,0].
  const rawBbox = Array.isArray(d.bbox) ? d.bbox : [];
  const clamp01 = (n: unknown): number => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  };
  const bbox: [number, number, number, number] = rawBbox.length === 4
    ? [clamp01(rawBbox[0]), clamp01(rawBbox[1]), clamp01(rawBbox[2]), clamp01(rawBbox[3])]
    : [0, 0, 0, 0];

  // qtyBbox 정규화: 4개 number 이고 하나라도 > 0 이면 clamp 해서 유지, 아니면 null (수량 위치 없음).
  const rawQtyBbox = Array.isArray(d.qtyBbox) ? d.qtyBbox : [];
  const qtyBbox: [number, number, number, number] | null =
    rawQtyBbox.length === 4 && rawQtyBbox.some((v) => Number(v) > 0)
      ? [clamp01(rawQtyBbox[0]), clamp01(rawQtyBbox[1]), clamp01(rawQtyBbox[2]), clamp01(rawQtyBbox[3])]
      : null;

  return {
    name: String(d.name ?? "").trim(),
    code: String(d.code ?? "").replace(/\D/g, ""),
    companyName: String(d.companyName ?? "").trim(),
    quantity: toNumOrNull(d.quantity),
    prescriptions: toInt(d.prescriptions),
    unitPrice: toNumOrNull(d.unitPrice),
    totalPrice: toNumOrNull(d.totalPrice),
    category: String(d.category ?? "").trim(),
    efficacy: String(d.efficacy ?? "").trim(),
    bbox,
    qtyBbox,
  };
}

export async function extractRxStatsFromImage(
  base64: string,
  mimeType: string,
  model: GeminiRxModel = DEFAULT_MODEL,
): Promise<{ data: RxExtractResult; debug: RxExtractDebug }> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY 미설정");
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const t0 = Date.now();
  const response = await ai.models.generateContent({
    model,
    // OCR 사전 처리 없이 사진 원본을 멀티모달 vision 에 그대로 전달.
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: buildPrompt() },
      ],
    }],
    config: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0,
      // 사진 한 장에 100+ 행 추출 가능하도록 출력 토큰 한도 명시.
      // Gemini 3.5 Flash 의 최대 출력 토큰. 약품 1행 ~ 80 토큰 × 200행 = 16K + summary/buffer.
      maxOutputTokens: 32768,
      // thinking 토큰이 maxOutputTokens 를 잠식해서 실제 응답이 잘리던 문제 방어.
      // 사진→표 추출은 단계 추론이 도움되지만 무한대(-1) 면 thinking 만 하고 output 못 내는 케이스.
      thinkingConfig: { thinkingBudget: 8192, includeThoughts: false },
    },
  });

  const raw = response.text ?? "";
  const parsed = parseJsonLoose(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Gemini 빈/잘못된 응답: ${raw.slice(0, 200)}`);
  }

  const summary = (parsed.summary ?? {}) as Record<string, unknown>;
  const drugsRaw = Array.isArray(parsed.drugs) ? parsed.drugs : [];
  const periodRaw = String(parsed.period ?? "").trim();

  const data: RxExtractResult = {
    pharma: String(parsed.pharma ?? "").trim(),
    period: normalizePeriod(periodRaw),
    periodRaw,
    hospital: String(parsed.hospital ?? "").trim(),
    summary: {
      drugCount: toInt(summary.drugCount),
      totalPrescriptions: toInt(summary.totalPrescriptions),
      totalQuantity: toNum(summary.totalQuantity),
      totalAmountWon: toInt(summary.totalAmountWon),
    },
    drugs: drugsRaw.map((d) => normalizeDrug(d as Record<string, unknown>)),
  };

  return {
    data,
    debug: { rawText: raw, model, durationMs: Date.now() - t0 },
  };
}

// 완전 빈손 판정. 호출처(API route) 가 422 응답 분기에 사용.
// 부분 추출 (예: 35행 중 25행만) 은 여기서 안 잡음 — UI 가 summary.drugCount vs
// drugs.length 비교로 경고 표시.
export function isRxExtractEmpty(d: RxExtractResult): boolean {
  if (d.drugs.length === 0) return true;
  if (d.summary.drugCount === 0 && d.summary.totalAmountWon === 0) return true;
  return false;
}
