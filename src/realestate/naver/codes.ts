// 네이버부동산 내부 코드 매핑.
// 매물종류(rletTpCd), 거래종류(tradTpCd) — 자주 쓰는 항목만.
// 전체 코드는 https://new.land.naver.com/offices 등에서 네트워크 탭으로 확인.

export const TRADE_CODE: Record<string, string> = {
  매매: "A1",
  전세: "B1",
  월세: "B2",
  단기임대: "B3",
};

export const PROPERTY_CODE: Record<string, string> = {
  // 상업/업무
  상가: "SG",
  상가건물: "SMS",
  사무실: "SMS",
  빌딩: "GJCG",
  공장창고: "GJCG",
  토지: "TJ",
  // 주거 (시세 비교용)
  아파트: "APT",
  오피스텔: "OPST",
  단독주택: "DDDGG",
  빌라: "VL",
  원룸: "OR",
};

export function tradeCodeOf(label: string): string | undefined {
  return TRADE_CODE[label];
}
export function propertyCodeOf(label: string): string | undefined {
  return PROPERTY_CODE[label];
}

// 네이버 API의 tradTpCd → 내부 라벨
export function tradeLabelOf(code: string | null | undefined): string {
  if (!code) return "기타";
  for (const [k, v] of Object.entries(TRADE_CODE)) if (v === code) return k;
  return code;
}
export function propertyLabelOf(code: string | null | undefined): string {
  if (!code) return "기타";
  for (const [k, v] of Object.entries(PROPERTY_CODE)) if (v === code) return k;
  return code;
}
