// 한국부동산원 상업용부동산 임대동향조사 — 공공데이터포털 OpenAPI.
//
// 발급:
//   data.go.kr → "한국부동산원_상업용부동산 임대동향조사 정보" → 활용신청 → 인증키
//   동일 인증키를 `RONE_SERVICE_KEY` 또는 `MOLIT_SERVICE_KEY` 로 재사용 가능
//   (공공데이터포털 인증키는 단일 계정 통합).
//
// 제공 항목 (분기 단위, 시군구·상권 단위):
//   - 임대료 (월 단위, 원/㎡)
//   - 공실률 (%)
//   - 투자수익률 (%, 연간)
//   - 소득수익률 / 자본수익률
//
// 매물 1건의 적정 월세 추정:
//   적정 월세 ≈ (실거래 매매가 × 소득수익률 ÷ 100) ÷ 12
//
// 단위 주의: 임대료는 "원/㎡" 이고 매물은 "만원" 단위. 환산 시 ×10000 ÷ 10000 매핑.

const ENDPOINTS = {
  // 권역별 평균 (오피스 / 중대형상가 / 소규모상가 / 집합상가)
  rentRegional: "https://apis.data.go.kr/1611000/nsdi-cmlndmReleaseService/getCmlndmReleaseStat",
  // 상권별 (강남대로·테헤란로 등)
  rentMarket: "https://apis.data.go.kr/1611000/nsdi-cmlndmReleaseService/getCmlndmMarketStat",
} as const;

export type RoneEndpoint = keyof typeof ENDPOINTS;

export interface RoneQuery {
  endpoint: RoneEndpoint;
  /** "OFFICE" | "MEDIUM" | "SMALL" | "COMPLEX" — 오피스/중대형상가/소규모상가/집합상가 */
  buildingType: "OFFICE" | "MEDIUM" | "SMALL" | "COMPLEX";
  /** YYYYQn — 예: "2025Q1" */
  yearQuarter: string;
  /** 시도/시군구 또는 상권 필터링 (옵션) */
  region?: string;
  numOfRows?: number;
  pageNo?: number;
}

export interface RoneItem {
  buildingType: string;
  region: string;
  regionCode: string | null;
  yearQuarter: string;
  rentPerM2: number | null;
  vacancyRate: number | null;
  yieldRate: number | null;
  capRate: number | null;
  raw: Record<string, string>;
}

const TYPE_LABEL: Record<RoneQuery["buildingType"], string> = {
  OFFICE: "오피스",
  MEDIUM: "중대형상가",
  SMALL: "소규모상가",
  COMPLEX: "집합상가",
};

export async function fetchRone(q: RoneQuery): Promise<RoneItem[]> {
  const key = process.env.RONE_SERVICE_KEY ?? process.env.MOLIT_SERVICE_KEY;
  if (!key) throw new Error("RONE_SERVICE_KEY (또는 MOLIT_SERVICE_KEY) 가 설정되지 않았어요.");

  const url = new URL(ENDPOINTS[q.endpoint]);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("BLDG_TYPE", q.buildingType);
  url.searchParams.set("YEAR_QT", q.yearQuarter);
  if (q.region) url.searchParams.set("REGION", q.region);
  url.searchParams.set("numOfRows", String(q.numOfRows ?? 1000));
  url.searchParams.set("pageNo", String(q.pageNo ?? 1));
  url.searchParams.set("_type", "json"); // R-ONE은 json/xml 둘 다 지원

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`R-ONE ${res.status}: ${await res.text().catch(() => "")}`);

  const txt = await res.text();
  // R-ONE은 응답 형식이 일관적이지 않아 (JSON or XML 응답 혼재) 양쪽 다 처리
  const items = txt.trim().startsWith("<") ? parseRoneXml(txt) : parseRoneJson(txt);
  return items.map(raw => normalize(raw, q));
}

function normalize(raw: Record<string, string>, q: RoneQuery): RoneItem {
  const num = (s?: string) => {
    if (!s) return null;
    const n = Number(String(s).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  };
  return {
    buildingType: TYPE_LABEL[q.buildingType],
    region: raw["region"] ?? raw["regionNm"] ?? raw["sigungu"] ?? raw["mktNm"] ?? "",
    regionCode: raw["regionCd"] ?? raw["sigunguCd"] ?? raw["mktCd"] ?? null,
    yearQuarter: q.yearQuarter,
    rentPerM2: num(raw["rent"] ?? raw["rentPrc"] ?? raw["rentArea"]),
    vacancyRate: num(raw["vacancy"] ?? raw["vcncRate"]),
    yieldRate: num(raw["yield"] ?? raw["invtYldRate"] ?? raw["totYldRate"]),
    capRate: num(raw["incomeYield"] ?? raw["incmYldRate"] ?? raw["capRate"]),
    raw,
  };
}

export function parseRoneJson(text: string): Record<string, string>[] {
  try {
    const j = JSON.parse(text);
    const items =
      j?.response?.body?.items?.item ??
      j?.response?.body?.items ??
      j?.items ??
      [];
    return Array.isArray(items) ? items : [items];
  } catch {
    return [];
  }
}

export function parseRoneXml(xml: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const obj: Record<string, string> = {};
    const f = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
    let fm: RegExpExecArray | null;
    while ((fm = f.exec(m[1]))) obj[fm[1]] = fm[2].trim();
    items.push(obj);
  }
  return items;
}
