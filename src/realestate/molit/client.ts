// 국토교통부 실거래가 공개 시스템 — 공공데이터포털 OpenAPI 클라이언트.
//
// 발급 절차:
//   1) https://www.data.go.kr 회원가입 → "국토교통부_상업업무용 부동산 매매 신고 자료"
//      (또는 오피스텔/연립다세대) API 활용 신청 → 인증키 발급
//   2) `MOLIT_SERVICE_KEY` 환경변수에 디코딩된 키를 넣는다 (인코딩된 키는 중복 인코딩됨)
//
// 본 클라이언트는 정부 공식 채널이므로 합법. 하루 호출 제한이 있으므로
// 캐시(MolitTrade 테이블)를 거쳐 사용한다.

const ENDPOINTS = {
  // 상업업무용 부동산 매매 (※ 상업용 전월세는 공공데이터에 없음)
  commercialSale: "https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade",
  // 토지 매매
  landSale: "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade",
  // 오피스텔
  officetelSale: "https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade",
  officetelRent: "https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent",
  // 아파트
  apartmentSale: "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
  apartmentRent: "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
  // 연립·다세대
  rowhouseSale: "https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade",
  rowhouseRent: "https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent",
  // 단독·다가구
  detachedSale: "https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade",
  detachedRent: "https://apis.data.go.kr/1613000/RTMSDataSvcSHRent/getRTMSDataSvcSHRent",
} as const;

export type MolitEndpoint = keyof typeof ENDPOINTS;

export interface MolitQuery {
  endpoint: MolitEndpoint;
  /** 5자리 법정동코드 (시군구). https://www.code.go.kr 에서 조회. */
  lawdCd: string;
  /** YYYYMM */
  dealYmd: string;
  numOfRows?: number;
  pageNo?: number;
}

export interface MolitTradeItem {
  dealKind: string;
  tradeType: "매매" | "전월세";
  region: string;
  lawdCd: string;
  dealYearMonth: string;
  dealDay: number | null;
  buildingName: string | null;
  areaM2: number | null;
  floor: string | null;
  buildYear: number | null;
  amount: number | null;       // 만원
  deposit: number | null;
  monthlyRent: number | null;
  raw: Record<string, string>;
}

const ENDPOINT_META: Record<MolitEndpoint, { dealKind: string; tradeType: "매매" | "전월세" }> = {
  commercialSale: { dealKind: "상업업무용", tradeType: "매매" },
  landSale: { dealKind: "토지", tradeType: "매매" },
  officetelSale: { dealKind: "오피스텔", tradeType: "매매" },
  officetelRent: { dealKind: "오피스텔", tradeType: "전월세" },
  apartmentSale: { dealKind: "아파트", tradeType: "매매" },
  apartmentRent: { dealKind: "아파트", tradeType: "전월세" },
  rowhouseSale: { dealKind: "연립다세대", tradeType: "매매" },
  rowhouseRent: { dealKind: "연립다세대", tradeType: "전월세" },
  detachedSale: { dealKind: "단독다가구", tradeType: "매매" },
  detachedRent: { dealKind: "단독다가구", tradeType: "전월세" },
};

export async function fetchMolitTrades(q: MolitQuery): Promise<MolitTradeItem[]> {
  const key = process.env.MOLIT_SERVICE_KEY;
  if (!key) throw new Error("MOLIT_SERVICE_KEY 환경변수가 설정되지 않았어요.");

  const url = new URL(ENDPOINTS[q.endpoint]);
  // 공공데이터포털은 serviceKey를 인코딩 1회만 허용. 디코딩된 키를 fetch URL에 직접 박는다.
  url.searchParams.set("LAWD_CD", q.lawdCd);
  url.searchParams.set("DEAL_YMD", q.dealYmd);
  url.searchParams.set("numOfRows", String(q.numOfRows ?? 1000));
  url.searchParams.set("pageNo", String(q.pageNo ?? 1));
  url.searchParams.set("serviceKey", key);

  const res = await fetch(url, { headers: { Accept: "application/xml" } });
  if (!res.ok) throw new Error(`MOLIT ${res.status}: ${await res.text().catch(() => "")}`);
  const xml = await res.text();
  const items = parseMolitXml(xml);
  const meta = ENDPOINT_META[q.endpoint];

  return items.map(raw => normalizeMolitItem(raw, q, meta));
}

function normalizeMolitItem(
  raw: Record<string, string>,
  q: MolitQuery,
  meta: { dealKind: string; tradeType: "매매" | "전월세" },
): MolitTradeItem {
  const num = (s?: string) => {
    if (!s) return null;
    const n = Number(s.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  };
  return {
    dealKind: meta.dealKind,
    tradeType: meta.tradeType,
    region: [raw["시군구"], raw["법정동"]].filter(Boolean).join(" ") || raw["법정동"] || "",
    lawdCd: q.lawdCd,
    dealYearMonth: q.dealYmd,
    dealDay: num(raw["일"] ?? raw["계약일"]),
    buildingName: raw["건물명"] ?? raw["단지"] ?? raw["아파트"] ?? null,
    areaM2: num(raw["전용면적"] ?? raw["계약면적"]),
    floor: raw["층"] ?? null,
    buildYear: num(raw["건축년도"]),
    amount: num(raw["거래금액"] ?? raw["물건금액"]),
    deposit: num(raw["보증금액"] ?? raw["보증금"]),
    monthlyRent: num(raw["월세금액"] ?? raw["월세"]),
    raw,
  };
}

/**
 * 미니 XML 파서. <item>...</item> 블록만 끄집어내고, 자식 노드를 평탄한 객체로 변환.
 * 외부 라이브러리 의존 없이 OpenAPI 응답 정도는 무리 없이 처리.
 */
export function parseMolitXml(xml: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml))) {
    const block = m[1];
    const obj: Record<string, string> = {};
    const fieldRegex = /<([A-Za-z0-9_가-힣]+)>([\s\S]*?)<\/\1>/g;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRegex.exec(block))) {
      obj[fm[1]] = fm[2].trim();
    }
    items.push(obj);
  }
  return items;
}
