// V월드 (vworld.kr) Open API 클라이언트.
// 무료. 인증키 발급 후 IP/도메인 등록 필요.
//
// 사용 흐름:
//   1) 지번 → 좌표:        geocodeJibun()         → /req/address?service=address
//   2) 좌표 → 필지(PNU):   getParcelByPoint()     → /req/data?data=LP_PA_CBND_BUBUN (point filter)
//   3) PNU → 필지 폴리곤:  getParcelByPnu()       → 동일 데이터, attrFilter=pnu:=:...
//   4) PNU → 용도지역:     getLandUse()           → data=LT_C_UQ111
//   5) PNU → 공시지가:     getOfficialPrice()     → data=LT_C_INDVDLPLOTLAND
//
// V월드 응답은 `response.status` 가 "OK" 일 때만 result가 있다. 에러 코드 별도 매핑.

import type { GeoJSON } from "./geo";

export interface VworldGeocodeResult {
  jibun: string;
  lat: number;
  lng: number;
  addressType: "PARCEL" | "ROAD";
  // V월드 geocoder는 PNU를 직접 주지 않음 → 좌표로 보조 호출 필요
}

export interface VworldParcel {
  pnu: string;
  jibun: string;
  area: number | null;       // ㎡
  sigungu: string | null;
  cortarNo: string | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  centerLat: number | null;
  centerLng: number | null;
  raw: Record<string, unknown>;
}

export interface VworldLandUse {
  pnu: string;
  zones: { name: string; type: "용도지역" | "용도지구" | "용도구역" }[];
  raw: Record<string, unknown>;
}

const BASE = "https://api.vworld.kr/req";

function getKey(): string {
  const k = process.env.VWORLD_API_KEY;
  if (!k) throw new Error("VWORLD_API_KEY 환경변수가 설정되지 않았어요.");
  return k;
}

// ─── 1) 지번/도로명 → 좌표 ───────────────────────────────────────────
export async function geocodeJibun(address: string): Promise<VworldGeocodeResult | null> {
  const url = new URL(`${BASE}/address`);
  url.searchParams.set("service", "address");
  url.searchParams.set("request", "getCoord");
  url.searchParams.set("address", address);
  url.searchParams.set("type", "PARCEL");
  url.searchParams.set("format", "json");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("key", getKey());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`vworld geocode ${res.status}`);
  const j: VworldGeocodeRaw = await res.json();
  if (j?.response?.status !== "OK") {
    // 도로명으로 재시도
    if (j?.response?.status === "NOT_FOUND") {
      url.searchParams.set("type", "ROAD");
      const r2 = await fetch(url);
      const j2: VworldGeocodeRaw = await r2.json();
      if (j2?.response?.status !== "OK") return null;
      return geocodeFromRaw(j2, address, "ROAD");
    }
    return null;
  }
  return geocodeFromRaw(j, address, "PARCEL");
}

function geocodeFromRaw(j: VworldGeocodeRaw, address: string, t: "PARCEL" | "ROAD"): VworldGeocodeResult | null {
  const p = j?.response?.result?.point;
  if (!p) return null;
  return {
    jibun: j?.response?.refined?.text ?? address,
    lat: Number(p.y),
    lng: Number(p.x),
    addressType: t,
  };
}

// ─── 2) 좌표 → 필지 (PNU 포함) ──────────────────────────────────────
export async function getParcelByPoint(lat: number, lng: number): Promise<VworldParcel | null> {
  // 좌표가 폴리곤 내부에 있는 필지 검색.
  // V월드는 geomFilter=POINT(lng lat) 형식으로 공간 필터를 받는다.
  const url = new URL(`${BASE}/data`);
  url.searchParams.set("service", "data");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("data", "LP_PA_CBND_BUBUN");
  url.searchParams.set("geomFilter", `POINT(${lng} ${lat})`);
  url.searchParams.set("geometry", "true");
  url.searchParams.set("format", "json");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("size", "1");
  url.searchParams.set("key", getKey());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`vworld parcel-by-point ${res.status}`);
  const j: VworldDataRaw = await res.json();
  return parseParcel(j);
}

// ─── 3) PNU → 필지 폴리곤 ───────────────────────────────────────────
export async function getParcelByPnu(pnu: string): Promise<VworldParcel | null> {
  const url = new URL(`${BASE}/data`);
  url.searchParams.set("service", "data");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("data", "LP_PA_CBND_BUBUN");
  url.searchParams.set("attrFilter", `pnu:=:${pnu}`);
  url.searchParams.set("geometry", "true");
  url.searchParams.set("format", "json");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("size", "1");
  url.searchParams.set("key", getKey());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`vworld parcel-by-pnu ${res.status}`);
  const j: VworldDataRaw = await res.json();
  return parseParcel(j);
}

function parseParcel(j: VworldDataRaw): VworldParcel | null {
  const f = j?.response?.result?.featureCollection?.features?.[0];
  if (!f) return null;
  const props = f.properties ?? {};
  const geom = (f.geometry ?? null) as GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  const center = geom ? polygonCentroid(geom) : null;
  const pnu = String(props.pnu ?? "");
  // PNU 19자리 = [10 법정동코드][1 산여부][4 본번][4 부번] → cortarNo 10자리
  const cortarFromPnu = /^\d{19}$/.test(pnu) ? pnu.slice(0, 10) : null;
  return {
    pnu,
    jibun: [props.ldCodeNm, props.mnnmSlno].filter(Boolean).join(" ") || String(props.jibun ?? ""),
    area: props.lndpcl_ar != null ? Number(props.lndpcl_ar) : null,
    sigungu: typeof props.ldCodeNm === "string" ? props.ldCodeNm.split(" ").slice(0, 2).join(" ") : null,
    cortarNo: cortarFromPnu
      ?? (props.ld_cd ? String(props.ld_cd) : null)
      ?? (props.ldCode ? String(props.ldCode) : null),
    geometry: geom,
    centerLat: center?.lat ?? null,
    centerLng: center?.lng ?? null,
    raw: f as unknown as Record<string, unknown>,
  };
}

// ─── 4) PNU → 용도지역/지구/구역 ────────────────────────────────────
export async function getLandUse(pnu: string): Promise<VworldLandUse> {
  const url = new URL(`${BASE}/data`);
  url.searchParams.set("service", "data");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("data", "LT_C_UQ111");
  url.searchParams.set("attrFilter", `pnu:=:${pnu}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", "100");
  url.searchParams.set("key", getKey());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`vworld landuse ${res.status}`);
  const j: VworldDataRaw = await res.json();
  const features = j?.response?.result?.featureCollection?.features ?? [];
  const zones = features
    .map(f => ({
      name: String(f.properties?.prposAreaDstrcCodeNm ?? ""),
      type: classifyZone(String(f.properties?.prposAreaDstrcCodeCdNm ?? f.properties?.prposAreaDstrcCodeNm ?? "")),
    }))
    .filter(z => z.name);
  return { pnu, zones, raw: features as unknown as Record<string, unknown> };
}

// ─── 5) PNU → 개별공시지가 (최근값) ────────────────────────────────
export async function getOfficialPrice(pnu: string): Promise<{ year: string; price: number } | null> {
  const url = new URL(`${BASE}/data`);
  url.searchParams.set("service", "data");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("data", "LT_C_LHBLPN");
  url.searchParams.set("attrFilter", `pnu:=:${pnu}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("size", "10");
  url.searchParams.set("key", getKey());
  const res = await fetch(url);
  if (!res.ok) return null;
  const j: VworldDataRaw = await res.json();
  const features = j?.response?.result?.featureCollection?.features ?? [];
  const sorted = features
    .map(f => ({
      year: String(f.properties?.stdrYear ?? f.properties?.crtfcYear ?? ""),
      price: Number(f.properties?.pblntfPclnd ?? f.properties?.officialPrice ?? 0),
    }))
    .filter(x => x.year && x.price > 0)
    .sort((a, b) => b.year.localeCompare(a.year));
  return sorted[0] ?? null;
}

function classifyZone(label: string): "용도지역" | "용도지구" | "용도구역" {
  if (label.includes("지구")) return "용도지구";
  if (label.includes("구역")) return "용도구역";
  return "용도지역";
}

/** 단순 평균 중심 — 정확한 면적 가중 중심은 아니지만 지도 표시용으로 충분. */
function polygonCentroid(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): { lat: number; lng: number } | null {
  const coords =
    g.type === "Polygon"
      ? g.coordinates[0]
      : g.coordinates[0]?.[0];
  if (!coords || coords.length === 0) return null;
  let sx = 0, sy = 0;
  for (const [x, y] of coords) { sx += x; sy += y; }
  return { lng: sx / coords.length, lat: sy / coords.length };
}

// ── 응답 타입 ────────────────────────────────────────────────────────
interface VworldGeocodeRaw {
  response?: {
    status?: string;
    result?: { point?: { x: string; y: string } };
    refined?: { text?: string };
  };
}
interface VworldDataRaw {
  response?: {
    status?: string;
    result?: {
      featureCollection?: {
        features?: Array<{
          properties?: Record<string, unknown>;
          geometry?: unknown;
        }>;
      };
    };
  };
}
