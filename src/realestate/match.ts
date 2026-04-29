import type { REListing, REWatch } from "@prisma/client";

/**
 * 워치 조건과 매물을 비교한다. 모든 조건이 통과(또는 미설정)되어야 true.
 */
export function matchListing(listing: REListing, watch: REWatch): boolean {
  if (!watch.enabled) return false;

  if (watch.cortarNos.length > 0) {
    if (!listing.cortarNo || !watch.cortarNos.includes(listing.cortarNo)) return false;
  }
  if (watch.propertyTypes.length > 0 && !watch.propertyTypes.includes(listing.propertyType)) return false;
  if (watch.tradeTypes.length > 0 && !watch.tradeTypes.includes(listing.tradeType)) return false;

  if (watch.priceSaleMax != null && listing.priceSale != null && listing.priceSale > watch.priceSaleMax) return false;
  if (watch.priceDepositMax != null && listing.priceDeposit != null && listing.priceDeposit > watch.priceDepositMax) return false;
  if (watch.priceMonthlyMax != null && listing.priceMonthly != null && listing.priceMonthly > watch.priceMonthlyMax) return false;

  const area = listing.areaExclusive ?? listing.areaSupply;
  if (watch.areaMinM2 != null && (area == null || area < watch.areaMinM2)) return false;
  if (watch.areaMaxM2 != null && area != null && area > watch.areaMaxM2) return false;

  const floorNum = parseFloorNumber(listing.floor);
  if (watch.floorMin != null && (floorNum == null || floorNum < watch.floorMin)) return false;
  if (watch.floorMax != null && floorNum != null && floorNum > watch.floorMax) return false;

  const haystack = `${listing.title ?? ""} ${listing.description ?? ""} ${listing.features.join(" ")}`.toLowerCase();
  if (watch.keywords.length > 0) {
    const hit = watch.keywords.some(k => haystack.includes(k.toLowerCase()));
    if (!hit) return false;
  }
  if (watch.excludeKeywords.length > 0) {
    const blocked = watch.excludeKeywords.some(k => haystack.includes(k.toLowerCase()));
    if (blocked) return false;
  }
  return true;
}

/** "3/10" 또는 "고/10" 같은 표기에서 현재 층을 추출. 한글이면 null. */
export function parseFloorNumber(floor: string | null): number | null {
  if (!floor) return null;
  const m = /^(-?\d+)/.exec(floor.trim());
  return m ? Number(m[1]) : null;
}
