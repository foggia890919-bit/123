// 네이버부동산 API 응답 일부만 발췌 — 실제 응답에는 더 많은 필드가 있지만
// 예제에서 자주 쓰는 핵심만 타입화.

export interface Region {
  cortarNo: string;     // 지역 코드 (시도/시군구/읍면동까지 단계별)
  cortarName: string;   // 지역명
  cortarType: "city" | "dvsn" | "sec";
  centerLat: number;
  centerLon: number;
}

export interface Article {
  articleNo: string;            // 매물번호
  articleName: string;          // 매물명 (단지명 또는 표시명)
  articleStatus: string;
  realEstateTypeCode: string;   // APT, TJ, SG, ...
  realEstateTypeName: string;   // 아파트, 토지, 상가, ...
  articleRealEstateTypeCode: string;
  articleRealEstateTypeName: string;
  tradeTypeCode: string;        // A1/B1/B2/B3
  tradeTypeName: string;        // 매매/전세/월세/단기임대
  verificationTypeCode?: string;
  floorInfo?: string;
  priceChangeState?: string;
  isPriceModification?: boolean;
  dealOrWarrantPrc?: string;    // 매매 or 보증금 (한글 단위 포함, ex: "5억 5,000")
  rentPrc?: string;             // 월세
  areaName?: string;
  area1?: number;               // 공급면적 (㎡)
  area2?: number;               // 전용면적 (㎡)
  direction?: string;
  articleConfirmYmd?: string;
  representativeImgUrl?: string;
  articleFeatureDesc?: string;
  tagList?: string[];
  buildingName?: string;
  sameAddrCnt?: number;
  sameAddrDirectCnt?: number;
  sameAddrMaxPrc?: string;
  sameAddrMinPrc?: string;
  realtorName?: string;
  cpid?: string;
  cpName?: string;
  latitude?: string;
  longitude?: string;
}

export interface ArticleListResponse {
  isMoreData: boolean;
  articleList: Article[];
}

export interface ListArticlesParams {
  cortarNo: string;
  realEstateTypes: readonly string[];
  tradeTypes?: readonly string[];
  page?: number;
  sort?: string;
  // 면적 (㎡)
  areaMin?: number;
  areaMax?: number;
  // 가격 (만원 단위 — 매매가/보증금 기준)
  priceMin?: number;
  priceMax?: number;
  // 월세 (만원)
  rentMin?: number;
  rentMax?: number;
  // 매물 진위 검증된 것만
  onlyVerifiedListings?: boolean;
}
