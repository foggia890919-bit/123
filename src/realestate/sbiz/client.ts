// 소상공인시장진흥공단 상권정보 — 공공데이터포털 OpenAPI.
//
// 발급:
//   data.go.kr → "소상공인시장진흥공단_상권정보" 활용신청 → 인증키
//   동일 인증키 통합 운영. SBIZ_SERVICE_KEY 또는 MOLIT_SERVICE_KEY.
//
// 본 클라이언트는 다음을 다룬다:
//   1) 행정동 → 상권 매칭 (storeListInDong)
//   2) 상권 단위 점포 수 / 업종 분포
//   3) 의료기관(병·의원·약국) 카운트 — 경쟁구도 평가용
//
// 임대시세 추정치는 별도 통계가 아닌 R-ONE 활용을 권장.

const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";

export interface SbizStore {
  storeNo: string;
  storeName: string;
  category1: string; // 대분류
  category2: string; // 중분류
  category3: string; // 소분류
  trarNo: string | null;
  trarName: string | null;
  cortarNo: string | null;
  sigungu: string | null;
  dong: string | null;
  lat: number | null;
  lng: number | null;
  raw: Record<string, string>;
}

/** 행정동(법정동코드 10자리)에 등록된 점포 목록 — 의료기관 카운트 등에 사용. */
export async function fetchStoresByDong(opts: {
  cortarNo: string;
  numOfRows?: number;
  pageNo?: number;
}): Promise<SbizStore[]> {
  const key = process.env.SBIZ_SERVICE_KEY ?? process.env.MOLIT_SERVICE_KEY;
  if (!key) throw new Error("SBIZ_SERVICE_KEY (또는 MOLIT_SERVICE_KEY) 가 없어요.");

  const url = new URL(`${BASE}/storeListInDong`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("divId", "adongCd");
  url.searchParams.set("key", opts.cortarNo);
  url.searchParams.set("numOfRows", String(opts.numOfRows ?? 1000));
  url.searchParams.set("pageNo", String(opts.pageNo ?? 1));
  url.searchParams.set("type", "json");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`SBIZ ${res.status}: ${await res.text().catch(() => "")}`);
  const j: { body?: { items?: SbizApiStore[] } } = await res.json().catch(() => ({}));
  const items = j?.body?.items ?? [];
  return items.map(toStore);
}

interface SbizApiStore {
  bizesId?: string;
  bizesNm?: string;
  indsLclsNm?: string;
  indsMclsNm?: string;
  indsSclsNm?: string;
  ctprvnNm?: string;
  signguNm?: string;
  adongNm?: string;
  adongCd?: string;
  lon?: string;
  lat?: string;
}

function toStore(r: SbizApiStore): SbizStore {
  return {
    storeNo: r.bizesId ?? "",
    storeName: r.bizesNm ?? "",
    category1: r.indsLclsNm ?? "",
    category2: r.indsMclsNm ?? "",
    category3: r.indsSclsNm ?? "",
    trarNo: null,
    trarName: null,
    cortarNo: r.adongCd ?? null,
    sigungu: r.signguNm ?? null,
    dong: r.adongNm ?? null,
    lat: r.lat ? Number(r.lat) : null,
    lng: r.lon ? Number(r.lon) : null,
    raw: r as unknown as Record<string, string>,
  };
}

/** 의료/약국 점포만 필터링 — 경쟁 분석용. */
export function filterMedical(stores: SbizStore[]): SbizStore[] {
  return stores.filter(s => {
    const cat = `${s.category1} ${s.category2} ${s.category3}`;
    return /의원|병원|치과|한의|약국|의료/.test(cat);
  });
}
