// LH 공공주택 분양·임대정보 OpenAPI (data.go.kr).
//
// 활용신청: "한국토지주택공사_공공주택 분양/임대 공고 정보"
// 인증키: LH_SERVICE_KEY (없으면 MOLIT_SERVICE_KEY 재사용)
// 응답: JSON

const BASE = "https://api.odcloud.kr/api/3043419/v1";

export interface LhNotice {
  externalId: string;
  source: "lh";
  noticeName: string;
  houseType: string | null;
  totalHouseholds: number | null;
  region: string | null;
  address: string | null;
  noticeAt: Date | null;
  applyStartAt: Date | null;
  applyEndAt: Date | null;
  moveInAt: Date | null;
  raw: Record<string, unknown>;
}

export interface LhQuery {
  pageNo?: number;
  numOfRows?: number;
}

function getKey(): string {
  const k = process.env.LH_SERVICE_KEY ?? process.env.MOLIT_SERVICE_KEY;
  if (!k) throw new Error("LH_SERVICE_KEY (또는 MOLIT_SERVICE_KEY) 가 없어요.");
  return k;
}

export async function fetchLhNotices(q: LhQuery = {}): Promise<LhNotice[]> {
  const url = new URL(`${BASE}/uddi:8c3aac56-b35e-4c64-9ee5-ccebd3e85ff6`);
  url.searchParams.set("serviceKey", getKey());
  url.searchParams.set("page", String(q.pageNo ?? 1));
  url.searchParams.set("perPage", String(q.numOfRows ?? 100));
  url.searchParams.set("returnType", "json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`LH ${res.status}`);
  const j: { data?: LhRaw[] } = await res.json().catch(() => ({}));
  return (j.data ?? []).map(normalize);
}

interface LhRaw {
  공고번호?: string;
  공고명?: string;
  주택구분?: string;
  공급호수?: string;
  지역?: string;
  주소?: string;
  공고일?: string;
  접수시작일?: string;
  접수마감일?: string;
  입주예정월?: string;
  [k: string]: string | undefined;
}

function normalize(r: LhRaw): LhNotice {
  return {
    externalId: String(r["공고번호"] ?? `${r["공고명"]}-${r["공고일"]}`),
    source: "lh",
    noticeName: String(r["공고명"] ?? ""),
    houseType: r["주택구분"] ?? null,
    totalHouseholds: r["공급호수"] ? Number(String(r["공급호수"]).replace(/[^\d]/g, "")) || null : null,
    region: r["지역"] ?? null,
    address: r["주소"] ?? null,
    noticeAt: parseDate(r["공고일"]),
    applyStartAt: parseDate(r["접수시작일"]),
    applyEndAt: parseDate(r["접수마감일"]),
    moveInAt: parseDate(r["입주예정월"], "ym"),
    raw: r as unknown as Record<string, unknown>,
  };
}

function parseDate(s?: string, mode: "ymd" | "ym" = "ymd"): Date | null {
  if (!s) return null;
  const cleaned = String(s).replace(/[^\d]/g, "");
  if (mode === "ymd" && cleaned.length === 8) {
    return new Date(Date.UTC(+cleaned.slice(0,4), +cleaned.slice(4,6)-1, +cleaned.slice(6,8)));
  }
  if (mode === "ym" && cleaned.length >= 6) {
    return new Date(Date.UTC(+cleaned.slice(0,4), +cleaned.slice(4,6)-1, 1));
  }
  return null;
}
