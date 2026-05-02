// 한국부동산원_청약홈 분양정보 OpenAPI (data.go.kr).
//
// 활용신청: "한국부동산원_청약홈 분양정보 조회 서비스"
// 주요 엔드포인트:
//   - getAPTLttotPblancDetail        : APT 분양공고 (가장 많이 사용)
//   - getRemnntLttotPblancDetail     : APT 잔여세대
//   - getUrbtyOfctlLttotPblancDetail : 도시형생활주택 / 오피스텔
//
// 인증키: APPLYHOME_SERVICE_KEY (없으면 MOLIT_SERVICE_KEY 재사용)
// 응답: XML

const BASE = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";
const ALT_BASE = "https://apis.data.go.kr/1613000/ApplyhomeInfoDetailSvc";

export interface ApplyhomeNotice {
  externalId: string;            // pblancNo
  source: "applyhome";
  noticeName: string;
  houseType: string | null;      // APT / 오피스텔 / 도시형생활주택
  totalHouseholds: number | null;
  generalHouseholds: number | null;
  specialHouseholds: number | null;
  region: string | null;
  cortarNo: string | null;
  address: string | null;
  noticeAt: Date | null;
  applyStartAt: Date | null;
  applyEndAt: Date | null;
  contractAt: Date | null;
  moveInAt: Date | null;
  raw: Record<string, unknown>;
}

export interface ApplyhomeQuery {
  /** YYYYMMDD ~ */
  fromDate?: string;
  toDate?: string;
  /** 시도 (예: "서울") */
  sido?: string;
  pageNo?: number;
  numOfRows?: number;
}

function getKey(): string {
  const k = process.env.APPLYHOME_SERVICE_KEY ?? process.env.MOLIT_SERVICE_KEY;
  if (!k) throw new Error("APPLYHOME_SERVICE_KEY (또는 MOLIT_SERVICE_KEY) 가 없어요.");
  return k;
}

/** APT 분양공고 — JSON 응답 (odcloud) 우선, 실패 시 XML(data.go.kr) fallback. */
export async function fetchAptNotices(q: ApplyhomeQuery): Promise<ApplyhomeNotice[]> {
  const key = getKey();
  // odcloud는 JSON, page+perPage 파라미터
  const url = new URL(`${BASE}/getAPTLttotPblancDetail`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("page", String(q.pageNo ?? 1));
  url.searchParams.set("perPage", String(q.numOfRows ?? 100));
  url.searchParams.set("returnType", "json");
  if (q.fromDate) url.searchParams.set("cond[RCRIT_PBLANC_DE::GTE]", q.fromDate);
  if (q.toDate) url.searchParams.set("cond[RCRIT_PBLANC_DE::LTE]", q.toDate);
  if (q.sido) url.searchParams.set("cond[SUBSCRPT_AREA_CODE_NM::EQ]", q.sido);

  const res = await fetch(url);
  if (res.ok) {
    const j: { data?: ApplyhomeRaw[] } = await res.json().catch(() => ({}));
    return (j.data ?? []).map(normalize);
  }
  // fallback: data.go.kr XML
  const xmlUrl = new URL(`${ALT_BASE}/getAPTLttotPblancDetail`);
  xmlUrl.searchParams.set("serviceKey", key);
  xmlUrl.searchParams.set("pageNo", String(q.pageNo ?? 1));
  xmlUrl.searchParams.set("numOfRows", String(q.numOfRows ?? 100));
  if (q.sido) xmlUrl.searchParams.set("SUBSCRPT_AREA_CODE_NM", q.sido);
  const r2 = await fetch(xmlUrl);
  if (!r2.ok) throw new Error(`applyhome ${r2.status}`);
  const xml = await r2.text();
  return parseXmlItems(xml).map(normalize);
}

function normalize(r: ApplyhomeRaw): ApplyhomeNotice {
  return {
    externalId: String(r.PBLANC_NO ?? r.HOUSE_MANAGE_NO ?? `${r.HOUSE_NM}-${r.RCRIT_PBLANC_DE}`),
    source: "applyhome",
    noticeName: String(r.HOUSE_NM ?? r.SUBSCRPT_HOUSE_NM ?? ""),
    houseType: r.HOUSE_DTL_SECD_NM ?? r.HOUSE_SECD_NM ?? null,
    totalHouseholds: toInt(r.TOT_SUPLY_HSHLDCO),
    generalHouseholds: toInt(r.TOT_SUPLY_HSHLDCO),
    specialHouseholds: toInt(r.SPSPLY_HSHLDCO),
    region: r.SUBSCRPT_AREA_CODE_NM ?? null,
    cortarNo: r.HSSPLY_ZIP ?? null,
    address: r.HSSPLY_ADRES ?? null,
    noticeAt: parseDate(r.RCRIT_PBLANC_DE),
    applyStartAt: parseDate(r.RCEPT_BGNDE),
    applyEndAt: parseDate(r.RCEPT_ENDDE),
    contractAt: parseDate(r.CNTRCT_CNCLS_BGNDE),
    moveInAt: parseDate(r.MVN_PREARNGE_YM, "ym"),
    raw: r as unknown as Record<string, unknown>,
  };
}

interface ApplyhomeRaw {
  PBLANC_NO?: string;
  HOUSE_MANAGE_NO?: string;
  HOUSE_NM?: string;
  SUBSCRPT_HOUSE_NM?: string;
  HOUSE_DTL_SECD_NM?: string;
  HOUSE_SECD_NM?: string;
  TOT_SUPLY_HSHLDCO?: string;
  SPSPLY_HSHLDCO?: string;
  SUBSCRPT_AREA_CODE_NM?: string;
  HSSPLY_ZIP?: string;
  HSSPLY_ADRES?: string;
  RCRIT_PBLANC_DE?: string;
  RCEPT_BGNDE?: string;
  RCEPT_ENDDE?: string;
  CNTRCT_CNCLS_BGNDE?: string;
  MVN_PREARNGE_YM?: string;
}

function toInt(s?: string): number | null {
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDate(s?: string, mode: "ymd" | "ym" = "ymd"): Date | null {
  if (!s) return null;
  const cleaned = s.replace(/[^\d]/g, "");
  if (mode === "ymd" && cleaned.length === 8) {
    return new Date(Date.UTC(+cleaned.slice(0,4), +cleaned.slice(4,6)-1, +cleaned.slice(6,8)));
  }
  if (mode === "ym" && cleaned.length >= 6) {
    return new Date(Date.UTC(+cleaned.slice(0,4), +cleaned.slice(4,6)-1, 1));
  }
  return null;
}

function parseXmlItems(xml: string): ApplyhomeRaw[] {
  const items: ApplyhomeRaw[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const o: Record<string, string> = {};
    const f = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
    let fm: RegExpExecArray | null;
    while ((fm = f.exec(m[1]))) o[fm[1]] = fm[2].trim();
    items.push(o as ApplyhomeRaw);
  }
  return items;
}
