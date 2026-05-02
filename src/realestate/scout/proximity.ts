// 좌표 기반 근접 매칭 — Haversine으로 거리 계산.
// PostGIS 없이 동작하도록 자체 구현. 데이터 양이 커지면 PostGIS ST_DWithin로 교체.

import { prisma } from "@/lib/prisma";

const EARTH_R = 6371000; // m

export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const λ1 = toRad(a.lng);
  const λ2 = toRad(b.lng);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export interface MatchOptions {
  /** 검색 반경 (m). 기본 1000m. */
  radiusM?: number;
  /** 최대 결과 수. */
  limit?: number;
  /** 분양 공고 좌표가 없는 경우 매칭 시도 안 함. */
  skipUngeocoded?: boolean;
}

/**
 * 한 분양 공고의 인접 매물(REListing) + 필지(Parcel)를 검색해서
 * NoticeParcelMatch에 저장. 반환은 {parcels, listings} 배열.
 */
export async function matchNoticeNeighbors(
  noticeId: string,
  opts: MatchOptions = {},
): Promise<{ parcels: number; listings: number }> {
  const radius = opts.radiusM ?? 1000;
  const notice = await prisma.apartmentNotice.findUnique({ where: { id: noticeId } });
  if (!notice) throw new Error("공고 없음");
  if (notice.latitude == null || notice.longitude == null) {
    if (opts.skipUngeocoded) return { parcels: 0, listings: 0 };
    throw new Error("공고에 좌표가 없어요");
  }
  const center = { lat: notice.latitude, lng: notice.longitude };

  // 1차 박스 필터 — 위경도 ±0.015 (~1.5km) 로 후보를 좁히고 정확한 거리 계산
  const dLat = radius / 111000; // ~111km/도
  const dLng = radius / (111000 * Math.cos((center.lat * Math.PI) / 180));

  const [parcels, listings] = await Promise.all([
    prisma.parcel.findMany({
      where: {
        centerLat: { gte: center.lat - dLat, lte: center.lat + dLat },
        centerLng: { gte: center.lng - dLng, lte: center.lng + dLng },
      },
      select: { id: true, centerLat: true, centerLng: true },
    }),
    prisma.rEListing.findMany({
      where: {
        latitude: { gte: center.lat - dLat, lte: center.lat + dLat },
        longitude: { gte: center.lng - dLng, lte: center.lng + dLng },
        closedAt: null,
      },
      select: { id: true, latitude: true, longitude: true },
    }),
  ]);

  // 정확한 거리·방향 계산 후 저장
  let pCount = 0, lCount = 0;
  for (const p of parcels) {
    if (p.centerLat == null || p.centerLng == null) continue;
    const d = haversine(center, { lat: p.centerLat, lng: p.centerLng });
    if (d > radius) continue;
    await prisma.noticeParcelMatch.create({
      data: {
        noticeId,
        parcelId: p.id,
        matchType: "parcel",
        distanceM: +d.toFixed(1),
        bearing: +bearing(center, { lat: p.centerLat, lng: p.centerLng }).toFixed(1),
      },
    }).catch(() => {});
    pCount++;
    if (opts.limit && pCount + lCount >= opts.limit) break;
  }
  for (const l of listings) {
    if (l.latitude == null || l.longitude == null) continue;
    const d = haversine(center, { lat: l.latitude, lng: l.longitude });
    if (d > radius) continue;
    await prisma.noticeParcelMatch.create({
      data: {
        noticeId,
        listingId: l.id,
        matchType: "listing",
        distanceM: +d.toFixed(1),
        bearing: +bearing(center, { lat: l.latitude, lng: l.longitude }).toFixed(1),
      },
    }).catch(() => {});
    lCount++;
    if (opts.limit && pCount + lCount >= opts.limit) break;
  }

  return { parcels: pCount, listings: lCount };
}

/** 활성 공고 전체에 대해 일괄 매칭 (cron용). */
export async function matchAllNotices(opts: MatchOptions = {}): Promise<{ notices: number; parcels: number; listings: number }> {
  const notices = await prisma.apartmentNotice.findMany({
    where: {
      latitude: { not: null },
      longitude: { not: null },
      // 입주 예정이 미래거나 1년 전 이내인 공고만
      OR: [
        { moveInAt: { gte: new Date() } },
        { moveInAt: { gte: new Date(Date.now() - 365 * 24 * 3600 * 1000) } },
      ],
    },
    select: { id: true },
  });

  let p = 0, l = 0;
  for (const n of notices) {
    const r = await matchNoticeNeighbors(n.id, { ...opts, skipUngeocoded: true }).catch(() => ({ parcels: 0, listings: 0 }));
    p += r.parcels;
    l += r.listings;
  }
  return { notices: notices.length, parcels: p, listings: l };
}
