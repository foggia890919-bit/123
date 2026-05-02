// 건강보험심사평가원 (HIRA) 병의원정보서비스 OpenAPI.
//
// 활용신청 (data.go.kr):
//   - "건강보험심사평가원_병의원 기본정보 서비스" → getHospBasisList
//   - "건강보험심사평가원_의료기관별 상세정보 서비스" → getDgsbjtInfo, getEqpInfo
//
// 인증키: HIRA_SERVICE_KEY (없으면 MOLIT_SERVICE_KEY 재사용)
// 응답: XML
//
// ykiho = HIRA가 부여한 의료기관 식별자 (암호화된 키). 의료기관별 상세조회의 PK.

const BASE = "https://apis.data.go.kr/B551182";

export interface HiraFacility {
  ykiho: string;
  name: string;
  facilityType: string | null;     // 종합병원/병원/의원/치과/한의원/약국
  bedCount: number | null;
  doctorCount: number | null;
  address: string | null;
  cortarNo: string | null;          // 행정구역 코드 (sgguCd 5자리 → 보강 필요)
  sigungu: string | null;
  latitude: number | null;
  longitude: number | null;
  openedAt: Date | null;
  raw: Record<string, string>;
}

export interface HiraQuery {
  /** 시도코드 (예: "110000" 서울) */
  sidoCd?: string;
  /** 시군구코드 (예: "110019" 강남구) */
  sgguCd?: string;
  /** 종별코드: 11=상급종합, 21=종합병원, 28=병원, 31=의원, 41=치과의원 등 */
  clCd?: string;
  /** 진료과목코드 (예: "01" 내과) */
  dgsbjtCd?: string;
  pageNo?: number;
  numOfRows?: number;
}

function getKey(): string {
  const k = process.env.HIRA_SERVICE_KEY ?? process.env.MOLIT_SERVICE_KEY;
  if (!k) throw new Error("HIRA_SERVICE_KEY (또는 MOLIT_SERVICE_KEY) 가 없어요.");
  return k;
}

/** 의료기관 기본정보 목록. 시도/시군구별 페이지네이션. */
export async function fetchFacilities(q: HiraQuery): Promise<HiraFacility[]> {
  const url = new URL(`${BASE}/hospInfoServicev2/getHospBasisList`);
  url.searchParams.set("ServiceKey", getKey());
  url.searchParams.set("pageNo", String(q.pageNo ?? 1));
  url.searchParams.set("numOfRows", String(q.numOfRows ?? 100));
  if (q.sidoCd) url.searchParams.set("sidoCd", q.sidoCd);
  if (q.sgguCd) url.searchParams.set("sgguCd", q.sgguCd);
  if (q.clCd) url.searchParams.set("clCd", q.clCd);
  if (q.dgsbjtCd) url.searchParams.set("dgsbjtCd", q.dgsbjtCd);
  url.searchParams.set("_type", "xml");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HIRA facilities ${res.status}`);
  const xml = await res.text();
  return parseItems(xml).map(normalizeFacility);
}

/** 진료과목 상세 (의료기관별 진료과목·전문의 수). */
export async function fetchSpecialties(ykiho: string): Promise<{ code: string; name: string; doctors: number | null }[]> {
  const url = new URL(`${BASE}/MadmDtlInfoService2.7/getDgsbjtInfo2.7`);
  url.searchParams.set("ServiceKey", getKey());
  url.searchParams.set("ykiho", ykiho);
  url.searchParams.set("numOfRows", "50");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HIRA specialty ${res.status}`);
  const xml = await res.text();
  return parseItems(xml).map(r => ({
    code: r["dgsbjtCd"] ?? "",
    name: r["dgsbjtCdNm"] ?? "",
    doctors: numOrNull(r["dgsbjtPrSdrCnt"]),
  })).filter(s => s.name);
}

/** 의료장비 보유 현황 (CT/MRI/초음파 등). */
export async function fetchEquipment(ykiho: string): Promise<{ name: string; count: number | null }[]> {
  const url = new URL(`${BASE}/MadmDtlInfoService2.7/getEqpInfo2.7`);
  url.searchParams.set("ServiceKey", getKey());
  url.searchParams.set("ykiho", ykiho);
  url.searchParams.set("numOfRows", "50");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HIRA equipment ${res.status}`);
  const xml = await res.text();
  return parseItems(xml).map(r => ({
    name: r["medEqpTpCdNm"] ?? r["medEqpNm"] ?? "",
    count: numOrNull(r["medEqpCnt"]),
  })).filter(e => e.name);
}

// ─── 파싱 ────────────────────────────────────────────────────────────
function parseItems(xml: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const o: Record<string, string> = {};
    const f = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
    let fm: RegExpExecArray | null;
    while ((fm = f.exec(m[1]))) o[fm[1]] = fm[2].trim();
    items.push(o);
  }
  return items;
}

function numOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeFacility(r: Record<string, string>): HiraFacility {
  const facType = r["clCdNm"] ?? null;
  return {
    ykiho: r["ykiho"] ?? "",
    name: r["yadmNm"] ?? "",
    facilityType: facType,
    bedCount: numOrNull(r["sickbdTrmtCnt"] ?? r["sickbdQty"]),
    doctorCount: numOrNull(r["drTotCnt"]),
    address: r["addr"] ?? null,
    cortarNo: r["emdongNm"] ? null : null, // 정밀 매핑은 별도 변환 필요
    sigungu: r["sgguCdNm"] ?? null,
    latitude: numOrNull(r["YPos"] ?? r["yPos"]),
    longitude: numOrNull(r["XPos"] ?? r["xPos"]),
    openedAt: parseYmd(r["estbDd"]),
    raw: r,
  };
}

function parseYmd(s?: string): Date | null {
  if (!s || !/^\d{8}$/.test(s)) return null;
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
}
