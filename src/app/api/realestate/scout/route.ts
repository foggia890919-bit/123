import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/realestate/scout
 *   ?moveInWithinMonths=24
 *   &region=강남구
 *   &minHouseholds=500
 *
 * 입주 N개월 이내 + 세대수 기준 분양 공고 + 인접 매물/필지 + 입지 점수.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const months = Number(url.searchParams.get("moveInWithinMonths") ?? 24);
  const region = url.searchParams.get("region");
  const minHH = Number(url.searchParams.get("minHouseholds") ?? 0);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 30), 100);

  const moveInLimit = new Date();
  moveInLimit.setMonth(moveInLimit.getMonth() + months);

  const notices = await prisma.apartmentNotice.findMany({
    where: {
      moveInAt: { lte: moveInLimit, gte: new Date() },
      ...(minHH > 0 ? { totalHouseholds: { gte: minHH } } : {}),
      ...(region ? { region: { contains: region } } : {}),
    },
    orderBy: { moveInAt: "asc" },
    take: limit,
    include: {
      matches: {
        orderBy: { distanceM: "asc" },
        take: 5,
      },
    },
  });

  // 매칭에 들어있는 parcel/listing의 식별 정보를 추가 조회
  const parcelIds = new Set<string>();
  const listingIds = new Set<string>();
  for (const n of notices) for (const m of n.matches) {
    if (m.parcelId) parcelIds.add(m.parcelId);
    if (m.listingId) listingIds.add(m.listingId);
  }
  const [parcels, listings, scores] = await Promise.all([
    prisma.parcel.findMany({
      where: { id: { in: [...parcelIds] } },
      select: { id: true, jibun: true, area: true, landUse: true, officialPrice: true },
    }),
    prisma.rEListing.findMany({
      where: { id: { in: [...listingIds] } },
      select: { id: true, title: true, address: true, tradeType: true, propertyType: true, priceSale: true, priceDeposit: true, priceMonthly: true, url: true },
    }),
    prisma.locationScore.findMany({
      where: { parcelId: { in: [...parcelIds] } },
      select: { parcelId: true, compositeScore: true, prescriptionScore: true, recommendedSpecialties: true, backingHouseholds: true, competitorClinics: true },
    }),
  ]);

  return NextResponse.json({
    notices,
    parcels: Object.fromEntries(parcels.map(p => [p.id, p])),
    listings: Object.fromEntries(listings.map(l => [l.id, l])),
    scores: Object.fromEntries(scores.map(s => [s.parcelId, s])),
  });
}
