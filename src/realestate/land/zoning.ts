// 국토계획법 시행령 별표 + 서울시·경기도 도시계획조례 기반
// 용도지역별 법정 건폐율(BCR) / 용적률(FAR) 룩업 테이블.
//
// 주의:
//   - 여기 값은 국토계획법 한도. 실제 적용은 지자체 조례가 더 엄격할 수 있다.
//   - V월드 토지정보의 `prposAreaDstrcCodeNm` 문자열을 키로 매칭.
//   - 서울 기준이며, 경기/지방 일부는 별도 보정 필요 (TODO).

export interface ZoningLimit {
  zone: string;
  bcr: number;  // %
  far: number;  // %
  note?: string;
}

const LIMITS: ZoningLimit[] = [
  // 주거지역
  { zone: "제1종전용주거지역", bcr: 50, far: 100 },
  { zone: "제2종전용주거지역", bcr: 50, far: 150 },
  { zone: "제1종일반주거지역", bcr: 60, far: 200 },
  { zone: "제2종일반주거지역", bcr: 60, far: 250 },
  { zone: "제3종일반주거지역", bcr: 50, far: 300 },
  { zone: "준주거지역",       bcr: 70, far: 500 },
  // 상업지역
  { zone: "근린상업지역",     bcr: 70, far: 900,  note: "지자체별 상이 (서울 기준)" },
  { zone: "유통상업지역",     bcr: 80, far: 1100 },
  { zone: "일반상업지역",     bcr: 80, far: 1300 },
  { zone: "중심상업지역",     bcr: 90, far: 1500 },
  // 공업지역
  { zone: "전용공업지역",     bcr: 70, far: 300 },
  { zone: "일반공업지역",     bcr: 70, far: 350 },
  { zone: "준공업지역",       bcr: 70, far: 400 },
  // 녹지지역 (사실상 시행 부적합)
  { zone: "보전녹지지역",     bcr: 20, far: 80 },
  { zone: "생산녹지지역",     bcr: 20, far: 100 },
  { zone: "자연녹지지역",     bcr: 20, far: 100 },
];

export function lookupZoning(zoneName: string | null | undefined): ZoningLimit | null {
  if (!zoneName) return null;
  const exact = LIMITS.find(l => l.zone === zoneName);
  if (exact) return exact;
  // 부분일치 fallback ("일반상업지역" → "일반상업")
  return LIMITS.find(l => zoneName.includes(l.zone.replace("지역", ""))) ?? null;
}

export function listZones(): ZoningLimit[] {
  return [...LIMITS];
}
