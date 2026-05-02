// 서울 열린데이터 광장 — 지하철 데이터.
//
// 발급:
//   https://data.seoul.go.kr → 회원가입 → "인증키 신청" → 일반 인증키 (즉시 발급)
//   동일 키로 모든 서울 OpenAPI 사용 가능. SEOUL_OPEN_API_KEY 환경변수.
//
// 본 클라이언트는 두 데이터셋을 다룬다:
//   1) 지하철역사 마스터 (좌표 포함): SearchSTNBySubwayLineInfo
//   2) 카드기준 일별 승하차: CardSubwayStatsNew
//
// 응답 형식: JSON. 일반적으로 `{ <SERVICE_NAME>: { row: [...] } }` 구조.

const BASE = "http://openapi.seoul.go.kr:8088";

function getKey(): string {
  const k = process.env.SEOUL_OPEN_API_KEY;
  if (!k) throw new Error("SEOUL_OPEN_API_KEY 환경변수가 설정되지 않았어요.");
  return k;
}

export interface SubwayStation {
  externalId: string;     // 역코드 (FR_CODE)
  name: string;
  lineNumber: string;     // "01호선" "02호선" 등
  latitude: number;
  longitude: number;
  raw: Record<string, unknown>;
}

export interface SubwayDailyRidership {
  date: string;           // YYYYMMDD
  lineNumber: string;
  stationName: string;
  rideCount: number;
  alightCount: number;
  raw: Record<string, unknown>;
}

/**
 * 서울 지하철 역사 정보 (좌표 포함).
 *   서비스명: SearchSTNBySubwayLineInfo
 *   필수: STATION_NM (없으면 전체)
 */
export async function fetchStations(opts: {
  stationName?: string;
  startIndex?: number;
  endIndex?: number;
} = {}): Promise<SubwayStation[]> {
  const start = opts.startIndex ?? 1;
  const end = opts.endIndex ?? 1000;
  const url = new URL(
    `${BASE}/${getKey()}/json/SearchInfoBySubwayNameService/${start}/${end}/${encodeURIComponent(opts.stationName ?? " ")}`,
  );
  // SearchInfoBySubwayNameService는 역명 검색 — 좌표 포함
  const res = await fetch(url);
  if (!res.ok) throw new Error(`subway-stations ${res.status}`);
  const j = await res.json().catch(() => ({}));
  const rows = pickRows(j, "SearchInfoBySubwayNameService");
  return rows.map((r): SubwayStation => ({
    externalId: String(r["STATION_CD"] ?? r["FR_CODE"] ?? `${r["LINE_NUM"]}-${r["STATION_NM"]}`),
    name: String(r["STATION_NM"] ?? ""),
    lineNumber: String(r["LINE_NUM"] ?? ""),
    latitude: Number(r["YPOINT_WGS84"] ?? r["YPOINT"] ?? 0),
    longitude: Number(r["XPOINT_WGS84"] ?? r["XPOINT"] ?? 0),
    raw: r,
  })).filter(s => s.latitude !== 0 && s.longitude !== 0);
}

/**
 * 일별 승하차 (카드 기준). YYYYMMDD 단일일.
 *   서비스명: CardSubwayStatsNew
 */
export async function fetchDailyRidership(useYmd: string): Promise<SubwayDailyRidership[]> {
  const url = new URL(`${BASE}/${getKey()}/json/CardSubwayStatsNew/1/1500/${useYmd}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`subway-ridership ${res.status}`);
  const j = await res.json().catch(() => ({}));
  const rows = pickRows(j, "CardSubwayStatsNew");
  return rows.map((r): SubwayDailyRidership => ({
    date: String(r["USE_YMD"] ?? useYmd),
    lineNumber: String(r["LINE_NUM"] ?? r["SUBWAY_LINE_NM"] ?? ""),
    stationName: String(r["SUB_STA_NM"] ?? r["STATION_NM"] ?? ""),
    rideCount: Number(r["RIDE_PASGR_NUM"] ?? 0),
    alightCount: Number(r["ALIGHT_PASGR_NUM"] ?? 0),
    raw: r,
  }));
}

function pickRows(j: unknown, service: string): Record<string, unknown>[] {
  const obj = j as Record<string, { row?: unknown[] } | undefined>;
  return (obj?.[service]?.row as Record<string, unknown>[] | undefined) ?? [];
}
