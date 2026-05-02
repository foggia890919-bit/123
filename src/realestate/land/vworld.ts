// V월드 (vworld.kr) Open API 클라이언트.
// 무료. 인증키 발급 후 IP 등록 또는 도메인 등록 필요.
//
// 주요 서비스:
//   - 주소 ↔ 좌표 변환:  /req/address?service=address
//   - 지번 검색 (필지):  /req/data?service=data&data=LP_PA_CBND_BUBUN
//   - 토지이용계획:      /req/data?service=data&data=LT_C_LHBLPN (또는 도시계획속성)
//   - 도시계획속성:      data=LT_C_UQ111
//
// 응답은 JSON 또는 XML — 본 클라이언트는 JSON 강제.

export interface VworldGeocodeResult {
  jibun: string;
  pnu: string;          // 19자리 필지고유번호
  lat: number;
  lng: number;
  addressType: "PARCEL" | "ROAD";
}

export interface VworldParcel {
  pnu: string;
  jibun: string;
  area: number | null;        // ㎡
  geometry: GeoJSONPolygon | null;
  raw: Record<string, unknown>;
}

export interface VworldLandUse {
  pnu: string;
  zones: { name: string; type: "용도지역" | "용도지구" | "용도구역" }[];
  raw: Record<string, unknown>;
}

interface GeoJSONPolygon {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

const BASE = "https://api.vworld.kr/req";

function getKey(): string {
  const k = process.env.VWORLD_API_KEY;
  if (!k) throw new Error("VWORLD_API_KEY 환경변수가 설정되지 않았어요.");
  return k;
}

/** 지번 → PNU + 좌표. */
export async function geocodeJibun(jibun: string): Promise<VworldGeocodeResult | null> {
  const url = new URL(`${BASE}/address`);
  url.searchParams.set("service", "address");
  url.searchParams.set("request", "getCoord");
  url.searchParams.set("address", jibun);
  url.searchParams.set("type", "PARCEL");
  url.searchParams.set("format", "json");
  url.searchParams.set("key", getKey());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`vworld geocode ${res.status}`);
  const j: VworldGeocodeRaw = await res.json();
  const r = j?.response?.result?.point;
  const refined = j?.response?.refined;
  if (!r || !refined) return null;
  return {
    jibun: refined.text ?? jibun,
    // V월드는 PNU를 별도 필드로 안 줌 — refined.structure를 조합해 PNU 산출 (TODO 보강)
    pnu: refined.structure?.code?.lawd ?? "",
    lat: Number(r.y),
    lng: Number(r.x),
    addressType: "PARCEL",
  };
}

/** PNU(또는 좌표) → 필지 폴리곤. */
export async function getParcelByPnu(pnu: string): Promise<VworldParcel | null> {
  const url = new URL(`${BASE}/data`);
  url.searchParams.set("service", "data");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("data", "LP_PA_CBND_BUBUN");
  url.searchParams.set("attrFilter", `pnu:=:${pnu}`);
  url.searchParams.set("geometry", "true");
  url.searchParams.set("format", "json");
  url.searchParams.set("key", getKey());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`vworld parcel ${res.status}`);
  const j: VworldDataRaw = await res.json();
  const f = j?.response?.result?.featureCollection?.features?.[0];
  if (!f) return null;
  return {
    pnu,
    jibun: f.properties?.jibun ?? "",
    area: f.properties?.lndpcl_ar ? Number(f.properties.lndpcl_ar) : null,
    geometry: (f.geometry ?? null) as GeoJSONPolygon | null,
    raw: f as unknown as Record<string, unknown>,
  };
}

/** PNU → 용도지역/지구/구역 목록. */
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
  const zones = features.map(f => ({
    name: String(f.properties?.prposAreaDstrcCodeNm ?? ""),
    type: classifyZone(String(f.properties?.prposAreaDstrcCodeCdNm ?? "")),
  })).filter(z => z.name);
  return { pnu, zones, raw: features as unknown as Record<string, unknown> };
}

function classifyZone(label: string): "용도지역" | "용도지구" | "용도구역" {
  if (label.includes("지구")) return "용도지구";
  if (label.includes("구역")) return "용도구역";
  return "용도지역";
}

// ── 응답 타입 (V월드 스펙 일부만) ─────────────────────────────────────
interface VworldGeocodeRaw {
  response?: {
    status?: string;
    result?: { point?: { x: string; y: string } };
    refined?: { text?: string; structure?: { code?: { lawd?: string } } };
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
