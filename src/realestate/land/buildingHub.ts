// 국토교통부 건축HUB - 건축물대장정보 서비스 (data.go.kr).
//
// 인증키: BUILDING_HUB_KEY (없으면 MOLIT_SERVICE_KEY 재사용 시도)
// 엔드포인트:
//   - getBrTitleInfo  : 표제부 (전체 면적·층수·구조·주용도)
//   - getBrFlrOulnInfo: 층별 개요 (층별 면적·용도·구조)
//   - getBrRecapTitleInfo: 총괄표제부 (대지내 모든 동 합산)
//
// 입력: PNU(19) → sigunguCd(5) + bjdongCd(5) + bun(4) + ji(4) + plat(1).
//   PNU 구조: [10자리 법정동코드][1자리 산:0/1][4자리 본번][4자리 부번]
//
// 응답: XML (resultCode=00이면 정상). 본 클라이언트는 XML 정규식으로 파싱.

const BASE = "https://apis.data.go.kr/1613000/BldRgstHubService";

export interface BuildingTitleInfo {
  pnu: string;
  bldgNm: string | null;
  totalFloorArea: number | null;   // 연면적 ㎡
  buildArea: number | null;        // 건축면적 ㎡
  bcr: number | null;              // 건폐율 %
  far: number | null;              // 용적률 %
  groundFloors: number | null;
  undergroundFloors: number | null;
  mainPurpose: string | null;
  structure: string | null;
  approvedAt: Date | null;
  raw: Record<string, string>;
}

export interface BuildingFloorOutline {
  pnu: string;
  floor: string;             // "1", "B1" 등
  floorType: "지상" | "지하" | "기타";
  area: number | null;
  purpose: string | null;
  structure: string | null;
}

export function pnuToParts(pnu: string): {
  sigunguCd: string;
  bjdongCd: string;
  platGbCd: string;
  bun: string;
  ji: string;
} | null {
  if (!/^\d{19}$/.test(pnu)) return null;
  return {
    sigunguCd: pnu.slice(0, 5),
    bjdongCd: pnu.slice(5, 10),
    platGbCd: pnu.slice(10, 11),
    bun: pnu.slice(11, 15),
    ji: pnu.slice(15, 19),
  };
}

function getKey(): string {
  const k = process.env.BUILDING_HUB_KEY ?? process.env.MOLIT_SERVICE_KEY;
  if (!k) throw new Error("BUILDING_HUB_KEY (또는 MOLIT_SERVICE_KEY) 가 없어요.");
  return k;
}

export async function getTitleInfo(pnu: string): Promise<BuildingTitleInfo[]> {
  const parts = pnuToParts(pnu);
  if (!parts) throw new Error(`PNU 형식 오류: ${pnu}`);

  const url = new URL(`${BASE}/getBrTitleInfo`);
  url.searchParams.set("serviceKey", getKey());
  url.searchParams.set("sigunguCd", parts.sigunguCd);
  url.searchParams.set("bjdongCd", parts.bjdongCd);
  url.searchParams.set("platGbCd", parts.platGbCd);
  url.searchParams.set("bun", parts.bun);
  url.searchParams.set("ji", parts.ji);
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("pageNo", "1");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`buildingHub title ${res.status}`);
  const xml = await res.text();
  return parseTitle(xml, pnu);
}

export async function getFloorOutline(pnu: string): Promise<BuildingFloorOutline[]> {
  const parts = pnuToParts(pnu);
  if (!parts) throw new Error(`PNU 형식 오류: ${pnu}`);

  const url = new URL(`${BASE}/getBrFlrOulnInfo`);
  url.searchParams.set("serviceKey", getKey());
  url.searchParams.set("sigunguCd", parts.sigunguCd);
  url.searchParams.set("bjdongCd", parts.bjdongCd);
  url.searchParams.set("platGbCd", parts.platGbCd);
  url.searchParams.set("bun", parts.bun);
  url.searchParams.set("ji", parts.ji);
  url.searchParams.set("numOfRows", "200");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`buildingHub floor ${res.status}`);
  const xml = await res.text();
  return parseFloorOutline(xml, pnu);
}

// ─── XML 파서 ───────────────────────────────────────────────────────
function extractItems(xml: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const obj: Record<string, string> = {};
    const f = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
    let fm: RegExpExecArray | null;
    while ((fm = f.exec(m[1]))) obj[fm[1]] = fm[2].trim();
    items.push(obj);
  }
  return items;
}

const num = (s?: string) => {
  if (!s) return null;
  const n = Number(s.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

function parseTitle(xml: string, pnu: string): BuildingTitleInfo[] {
  return extractItems(xml).map(r => ({
    pnu,
    bldgNm: r["bldNm"] ?? r["BLD_NM"] ?? null,
    totalFloorArea: num(r["totArea"]),
    buildArea: num(r["archArea"]),
    bcr: num(r["bcRat"]),
    far: num(r["vlRat"]),
    groundFloors: num(r["grndFlrCnt"]) as number | null,
    undergroundFloors: num(r["ugrndFlrCnt"]) as number | null,
    mainPurpose: r["mainPurpsCdNm"] ?? r["mainPurps"] ?? null,
    structure: r["strctCdNm"] ?? null,
    approvedAt: r["useAprDay"] ? parseYmd(r["useAprDay"]) : null,
    raw: r,
  }));
}

function parseFloorOutline(xml: string, pnu: string): BuildingFloorOutline[] {
  return extractItems(xml).map(r => {
    const flrNoNm = r["flrNoNm"] ?? "";
    const flrGbCdNm = r["flrGbCdNm"] ?? "";
    return {
      pnu,
      floor: flrNoNm,
      floorType:
        flrGbCdNm.includes("지하") ? "지하"
        : flrGbCdNm.includes("지상") ? "지상"
        : "기타",
      area: num(r["area"]),
      purpose: r["mainPurpsCdNm"] ?? null,
      structure: r["strctCdNm"] ?? null,
    };
  });
}

function parseYmd(s: string): Date | null {
  if (!/^\d{8}$/.test(s)) return null;
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))));
}
