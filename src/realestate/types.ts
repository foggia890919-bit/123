// Real-estate domain types — kept independent from Prisma so that the scraper
// can run without DB access (CSV-only mode for quick experiments).

export type TradeType = "매매" | "전세" | "월세" | "단기임대";
export type PropertyKind =
  | "상가"
  | "사무실"
  | "빌딩"
  | "토지"
  | "공장창고"
  | "아파트"
  | "오피스텔"
  | "주택"
  | "기타";

export interface RawListing {
  externalId: string;
  url: string | null;
  tradeType: TradeType | string;
  propertyType: PropertyKind | string;
  title: string | null;
  cortarNo: string | null;
  address: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  priceSale: number | null;     // 만원
  priceDeposit: number | null;
  priceMonthly: number | null;
  areaSupply: number | null;    // ㎡
  areaExclusive: number | null;
  floor: string | null;
  description: string | null;
  features: string[];
  postedAt: Date | null;
  agent: RawAgent | null;
  raw: Record<string, unknown>;
}

export interface RawAgent {
  externalId: string;
  name: string;
  phone: string | null;
  address: string | null;
  representative: string | null;
  registrationNo: string | null;
}

export interface SearchQuery {
  cortarNo: string;          // 행정동 코드
  tradeTypes?: string[];     // ["A1","B1","B2"] (네이버 코드)
  propertyTypes?: string[];  // ["SG","SMS","GJCG"...]
  priceMin?: number;         // 만원
  priceMax?: number;
  page?: number;
}
