// 네이버부동산 내부 API에서 쓰는 필터 코드 모음.
// 카테고리별로 묶어두고 RealEstateType / TradeType / Direction 등으로 export.

// 매물 종류 (realEstateType). 콤마 구분 문자열로 API에 전달.
export const RealEstateType = {
  // 주거
  APT: "APT",       // 아파트
  OPST: "OPST",     // 오피스텔
  ABYG: "ABYG",     // 아파트분양권
  OBYG: "OBYG",     // 오피스텔분양권
  JGC: "JGC",       // 재건축
  JGB: "JGB",       // 재개발
  VL: "VL",         // 빌라
  YR: "YR",         // 연립
  DDDGG: "DDDGG",   // 단독/다가구
  DSD: "DSD",       // 단독
  DGG: "DGG",       // 다가구
  HOJT: "HOJT",     // 한옥주택
  JWJT: "JWJT",     // 전원주택
  OR: "OR",         // 원룸

  // 토지
  TJ: "TJ",         // 토지
  LAND: "LAND",     // (별칭) 토지

  // 상업·업무용
  SG: "SG",         // 상가
  SMS: "SMS",       // 사무실
  SB: "SB",         // 상가건물
  GJCG: "GJCG",     // 공장/창고
  GM: "GM",         // 건물(통건물)
  KSG: "KSG",       // 지식산업센터
  GSW: "GSW",       // 고시원
  APTHGJ: "APTHGJ", // 숙박/콘도

  // 기타
  STORE: "STORE",   // 점포(권리)
} as const;
export type RealEstateType = (typeof RealEstateType)[keyof typeof RealEstateType];

export const RealEstateTypeLabel: Record<string, string> = {
  APT: "아파트",
  OPST: "오피스텔",
  ABYG: "아파트분양권",
  OBYG: "오피스텔분양권",
  JGC: "재건축",
  JGB: "재개발",
  VL: "빌라",
  YR: "연립",
  DDDGG: "단독/다가구",
  DSD: "단독",
  DGG: "다가구",
  HOJT: "한옥주택",
  JWJT: "전원주택",
  OR: "원룸",
  TJ: "토지",
  LAND: "토지",
  SG: "상가",
  SMS: "사무실",
  SB: "상가건물",
  GJCG: "공장/창고",
  GM: "건물",
  KSG: "지식산업센터",
  GSW: "고시원",
  APTHGJ: "숙박/콘도",
  STORE: "점포(권리)",
};

// 자주 쓰는 카테고리 묶음
export const RealEstateCategory = {
  주거: [
    RealEstateType.APT, RealEstateType.OPST, RealEstateType.VL, RealEstateType.YR,
    RealEstateType.DDDGG, RealEstateType.HOJT, RealEstateType.JWJT, RealEstateType.OR,
  ],
  토지: [RealEstateType.TJ, RealEstateType.LAND],
  상업: [
    RealEstateType.SG, RealEstateType.SMS, RealEstateType.SB,
    RealEstateType.GJCG, RealEstateType.GM, RealEstateType.KSG,
    RealEstateType.STORE,
  ],
  분양권: [RealEstateType.ABYG, RealEstateType.OBYG],
  재건축_재개발: [RealEstateType.JGC, RealEstateType.JGB],
} as const;

// 거래 유형 (tradeType). 콤마 구분 가능.
export const TradeType = {
  A1: "A1", // 매매
  B1: "B1", // 전세
  B2: "B2", // 월세
  B3: "B3", // 단기임대
} as const;
export type TradeType = (typeof TradeType)[keyof typeof TradeType];

export const TradeTypeLabel: Record<string, string> = {
  A1: "매매",
  B1: "전세",
  B2: "월세",
  B3: "단기임대",
};

// 검색 결과 정렬
export const SortType = {
  rank: "rank",       // 추천순
  date: "date",       // 최신순
  priceAsc: "priceAsc",
  priceDsc: "priceDsc",
  spcAsc: "spcAsc",   // 면적 작은순
  spcDsc: "spcDsc",   // 면적 큰순
} as const;
export type SortType = (typeof SortType)[keyof typeof SortType];

// 필터 조립 헬퍼
export function joinTypes(types: readonly string[]): string {
  return Array.from(new Set(types)).join(":");
}
