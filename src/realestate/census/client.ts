// 행정안전부 주민등록 인구통계 OpenAPI (data.go.kr).
//
// 활용신청: "행정안전부_주민등록 인구 및 세대현황"
// 또는: 통계청 KOSIS 인구총조사 (정밀 연령구간)
//
// 인증키: CENSUS_SERVICE_KEY (없으면 MOLIT_SERVICE_KEY 재사용)
// 본 클라이언트는 행정동 단위 월별 통계를 가져온다.

const BASE = "https://apis.data.go.kr/1741000/admmPpltn";

export interface CensusItem {
  cortarNo: string;
  yearMonth: string;
  totalPop: number | null;
  households: number | null;
  age0_9: number | null;
  age10_19: number | null;
  age20_29: number | null;
  age30_39: number | null;
  age40_49: number | null;
  age50_59: number | null;
  age60_69: number | null;
  age70Plus: number | null;
  malePop: number | null;
  femalePop: number | null;
  raw: Record<string, string>;
}

function getKey(): string {
  const k = process.env.CENSUS_SERVICE_KEY ?? process.env.MOLIT_SERVICE_KEY;
  if (!k) throw new Error("CENSUS_SERVICE_KEY (또는 MOLIT_SERVICE_KEY) 가 없어요.");
  return k;
}

export async function fetchCensus(opts: {
  cortarNo: string; // 10자리 행정동
  yearMonth: string; // YYYYMM
}): Promise<CensusItem | null> {
  const url = new URL(`${BASE}/selectAdmmPpltn`);
  url.searchParams.set("serviceKey", getKey());
  url.searchParams.set("admmCd", opts.cortarNo);
  url.searchParams.set("baseYm", opts.yearMonth);
  url.searchParams.set("type", "json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`census ${res.status}`);
  const j: CensusRaw = await res.json().catch(() => ({}));
  const item = j?.response?.body?.items?.[0] ?? j?.body?.items?.[0];
  if (!item) return null;
  return normalize(item, opts);
}

interface CensusRaw {
  response?: { body?: { items?: Record<string, string>[] } };
  body?: { items?: Record<string, string>[] };
}

function normalize(r: Record<string, string>, q: { cortarNo: string; yearMonth: string }): CensusItem {
  const num = (k: string) => {
    const v = r[k];
    if (!v) return null;
    const n = Number(String(v).replace(/[^\d-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  return {
    cortarNo: q.cortarNo,
    yearMonth: q.yearMonth,
    totalPop: num("totPpltn") ?? num("총인구"),
    households: num("hshldCnt") ?? num("세대수"),
    age0_9: num("age0_9") ?? num("ageGrp0Cnt"),
    age10_19: num("age10_19") ?? num("ageGrp10Cnt"),
    age20_29: num("age20_29") ?? num("ageGrp20Cnt"),
    age30_39: num("age30_39") ?? num("ageGrp30Cnt"),
    age40_49: num("age40_49") ?? num("ageGrp40Cnt"),
    age50_59: num("age50_59") ?? num("ageGrp50Cnt"),
    age60_69: num("age60_69") ?? num("ageGrp60Cnt"),
    age70Plus: num("age70_") ?? num("ageGrp70Cnt"),
    malePop: num("maleCnt") ?? num("남자인구"),
    femalePop: num("femaleCnt") ?? num("여자인구"),
    raw: r,
  };
}
