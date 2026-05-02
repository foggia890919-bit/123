// 보행 거리/시간 추정.
//
// 정밀 보행 길찾기는 카카오 모빌리티/T-map Pedestrian API가 필요하지만, 후보지
// 단순 점수에는 Haversine × 1.3 (격자/우회 보정) + 평균 도보 속도 1.3 m/s
// 으로도 충분히 유효. 정밀 분석이 필요하면 나중에 외부 API로 교체.

import { haversine } from "../scout/proximity";

const DETOUR_FACTOR = 1.3;       // 직선 → 도보 거리 보정
const WALK_SPEED_M_S = 1.3;      // 평지 평균

export interface WalkEstimate {
  straightLineM: number;
  walkingDistanceM: number;
  walkingMinutes: number;
}

export function estimateWalk(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): WalkEstimate {
  const sl = haversine(a, b);
  const walk = sl * DETOUR_FACTOR;
  const minutes = walk / WALK_SPEED_M_S / 60;
  return {
    straightLineM: +sl.toFixed(1),
    walkingDistanceM: +walk.toFixed(1),
    walkingMinutes: +minutes.toFixed(1),
  };
}

/**
 * 후보지 좌표에서 가장 가까운 지하철역 + 도보시간.
 * DB에 SubwayStation이 비어있으면 null 반환.
 */
export async function nearestStation(
  point: { lat: number; lng: number },
  prisma: typeof import("@/lib/prisma").prisma,
  searchRadiusM = 1500,
): Promise<{ station: { id: string; name: string; lineNumber: string; latitude: number; longitude: number }; walk: WalkEstimate } | null> {
  const dLat = searchRadiusM / 111000;
  const dLng = searchRadiusM / (111000 * Math.cos((point.lat * Math.PI) / 180));
  const candidates = await prisma.subwayStation.findMany({
    where: {
      latitude: { gte: point.lat - dLat, lte: point.lat + dLat },
      longitude: { gte: point.lng - dLng, lte: point.lng + dLng },
    },
  });
  if (candidates.length === 0) return null;
  let best: { station: typeof candidates[number]; walk: WalkEstimate } | null = null;
  for (const s of candidates) {
    const w = estimateWalk(point, { lat: s.latitude, lng: s.longitude });
    if (!best || w.walkingDistanceM < best.walk.walkingDistanceM) {
      best = { station: s, walk: w };
    }
  }
  return best;
}
