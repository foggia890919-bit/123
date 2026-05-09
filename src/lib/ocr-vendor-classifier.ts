// 처방통계 이미지의 EMR 벤더 + 캡처 방식 분류기.
//
// 한 달 동안 단일 OCR 파이프라인이 모든 케이스를 동시 처리하면서 두더지잡기가 됐던 문제를 끊기 위해,
// OCR 본 작업 전에 (벤더, 캡처 종류) 라벨을 먼저 붙인다. 이후 단계에서 이 라벨로:
//   - ColumnTemplate 캐시를 (clientId × vendor) 로 분리 (같은 거래처가 EMR 두 개 쓰는 경우)
//   - 모니터 사진은 언샤프 끄고 median blur 분기 (모아레)
//   - 종이 사진은 4-corner 워프 후 OCR
//   - 스크린샷은 전처리 거의 생략
// 분기를 안전하게 적용할 수 있다.
//
// 분류는 Gemini Vision 1콜로 처리. 메인 Clova/Vision 호출과 병렬로 돌려 latency 영향 ~0.

import { GoogleGenAI } from "@google/genai";

// 한국 의원·병원·약국에서 자주 쓰는 EMR + unknown.
// 새 EMR이 발견되면 이 배열에 추가하고 VENDOR_HINTS 의 키워드만 갱신하면 된다.
export const EMR_VENDORS = [
  "doctor",         // 의사랑 v1 (창 제목 "[병원명]-doctor")
  "doctor2",        // 의사랑 v2 (창 제목 "[병원명]-doctor2")
  "u-pharm",        // U pharm system (좌상단 "U pharm system" 로고)
  "eghis",          // eGhis 통합
  "nh-pharm",       // NH팜
  "chartfree",      // 차트프리 / 차트
  "emrpro",         // EMRpro
  "biit",           // 비트 (BIT)
  "dubeone",        // 두번에
  "pharm-it3000",   // 약국 — PHARM IT3000 (조제자료분석 화면)
  "unknown",
] as const;

export type EmrVendor = (typeof EMR_VENDORS)[number];

// photo: 종이 출력물을 카메라로 촬영 (종이결·손가락·책상 노이즈)
// screenshot: PC 에서 직접 캡처한 디지털 이미지 (픽셀 깨끗, anti-alias 만)
// monitor: 모니터 화면을 카메라로 촬영 (모아레·화면 베젤·서브픽셀 격자)
export type CaptureType = "photo" | "screenshot" | "monitor";

export interface VendorClassification {
  vendor: EmrVendor;
  captureType: CaptureType;
  confidence: number;        // 0-100, 자체평가
  rationale: string;         // 디버그용 — 어떤 단서로 판단했는지 한 줄
  error: string | null;      // 분류 실패 시 사유. 실패해도 vendor=unknown / captureType=photo 로 폴백 → 파이프라인 진행
}

// 각 vendor 의 시각 단서 — prompt 에 그대로 박아넣어 LLM 판별 정확도를 높인다.
// 이 키워드는 "이런 게 보이면 그 vendor" 라는 양방향 hint 이므로,
// 추후 fast-path (타이틀바 OCR → 키워드 매칭) 를 만들 때도 그대로 재사용할 수 있다.
const VENDOR_HINTS: Record<Exclude<EmrVendor, "unknown">, string> = {
  doctor: '윈도우 타이틀바에 "[병원명]-doctor" (v2 가 아닌 단순 doctor)',
  doctor2: '윈도우 타이틀바에 "[병원명]-doctor2"',
  "u-pharm": '좌상단 로고 "U pharm system" 또는 "유팜"',
  eghis: '상단 헤더에 "eGhis" 또는 "eGhis 통합"',
  "nh-pharm": '상단 또는 표 위에 "NH팜" 텍스트, 좌측 상단 로고',
  chartfree: '"차트프리" 또는 "차트" UI 패턴 — 보통 우측 상단에 작은 도구 모음',
  emrpro: '"EMRpro" 또는 "이엠알프로" 표기',
  biit: '"BIT" / "비트" 로고. 푸른색 헤더 띠가 흔함',
  dubeone: '"두번에" 한글 로고 또는 헤더',
  "pharm-it3000": '약국 EMR — 좌상단 "PHARM IT3000" 로고. 메뉴에 "스피드콜 / 조제·판매 / 구매재고 / 청구관리". 탭 "조제자료분석" 화면에서 위쪽 [발행기관별 / 처방의사별 / 보험종별] 표 + 아래쪽 [약품별 / 고객별] 표가 동시에 보임. 약품별 표 컬럼: "약품명 / 조제단가 / 조제량 / 조제금액"',
};

const PROMPT = `당신은 한국 의료기관에서 사용하는 EMR(전자의무기록) 처방통계 화면/출력물을 식별하는 전문가입니다.

# 작업 1: vendor 식별
이 이미지가 어느 EMR 에서 나왔는지 분류하세요. 후보:

${(Object.entries(VENDOR_HINTS) as [Exclude<EmrVendor, "unknown">, string][])
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}
- unknown: 위 어느 것도 단서가 없거나 확신할 수 없음

판별 우선순위 (위에서 아래로):
1) 윈도우 타이틀바 텍스트 (가장 강력한 단서)
2) 좌상단 로고
3) 상단 보고서 제목/헤더 텍스트
4) 표 컬럼 구성 패턴

# 작업 2: captureType 식별
이미지가 어떻게 만들어졌는지:
- photo: 종이를 휴대폰/카메라로 촬영 (종이결, 손가락이나 책상 보임, 종이 가장자리 휨)
- screenshot: PC 에서 직접 화면 캡처 (픽셀 깨끗, anti-alias 만 있음, 모아레 없음)
- monitor: 모니터 화면을 카메라로 재촬영 (무지개 모아레 줄무늬, 픽셀 격자 보임, 화면 베젤 있을 수 있음)

# 출력 형식
JSON 만 반환:
{
  "vendor": "doctor" | "doctor2" | "u-pharm" | "eghis" | "nh-pharm" | "chartfree" | "emrpro" | "biit" | "dubeone" | "unknown",
  "captureType": "photo" | "screenshot" | "monitor",
  "confidence": 0-100,
  "rationale": "어느 단서로 판단했는지 한 줄 (예: '타이틀바 [김앤김내과의원]-doctor 발견')"
}`;

const VALID_VENDORS = new Set<EmrVendor>(EMR_VENDORS);
const VALID_CAPTURE: Set<CaptureType> = new Set(["photo", "screenshot", "monitor"]);

const FALLBACK: VendorClassification = {
  vendor: "unknown",
  captureType: "photo",     // 보수적 — 모르면 종이 사진 가정 (전처리 더 강하게)
  confidence: 0,
  rationale: "분류기 폴백",
  error: null,
};

export async function classifyVendor(
  base64: string,
  mimeType: string
): Promise<VendorClassification> {
  if (!process.env.GEMINI_API_KEY) {
    return { ...FALLBACK, error: "GEMINI_API_KEY 미설정" };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: PROMPT },
        ],
      }],
      config: { responseMimeType: "application/json" },
    });

    const raw = response.text ?? "";
    const parsed = parseJsonLoose(raw) as Partial<VendorClassification> | null;
    if (!parsed) {
      return { ...FALLBACK, error: `JSON 파싱 실패: ${raw.slice(0, 120)}` };
    }

    const vendor = VALID_VENDORS.has(parsed.vendor as EmrVendor)
      ? (parsed.vendor as EmrVendor)
      : "unknown";
    const captureType = VALID_CAPTURE.has(parsed.captureType as CaptureType)
      ? (parsed.captureType as CaptureType)
      : "photo";
    const confidence = clamp01_100(Number(parsed.confidence) || 0);
    const rationale = String(parsed.rationale ?? "").slice(0, 200);

    return { vendor, captureType, confidence, rationale, error: null };
  } catch (e) {
    return { ...FALLBACK, error: String(e).slice(0, 200) };
  }
}

// route.ts 의 fetchCachedColumnTemplate 가 캐시 키로 vendor 를 같이 쓸 때, 저장된 vendor 와
// 현재 요청 vendor 가 호환되는지 판단. 정확히 같으면 OK, 한쪽이 unknown 이면 cross-use 허용
// (분류 실패한 경우라도 마지막 캐시는 활용). 다른 vendor 끼리는 절대 cross-use 안 함.
export function isVendorCompatible(cached: string | null | undefined, current: EmrVendor): boolean {
  if (!cached) return true;          // 옛 데이터(분류기 도입 전) — 일단 허용
  if (cached === current) return true;
  if (cached === "unknown" || current === "unknown") return true;
  return false;
}

function clamp01_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 1 && n > 0) return Math.round(n * 100);
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseJsonLoose(text: string): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fallthrough */ }
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
