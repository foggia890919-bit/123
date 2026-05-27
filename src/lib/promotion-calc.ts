export const GRADE_DISCOUNT: Record<string, number> = {
  A: 0.5,
  B: 1.0,
  C: 2.0,
};

export const PROMOTION_DURATION_MONTHS = 6;

export function calculatePromotionRate(
  baseRate: number,
  grade: string | null,
): number {
  if (!grade || !(grade in GRADE_DISCOUNT)) return baseRate;
  return Math.max(0, baseRate - GRADE_DISCOUNT[grade]);
}

export function isPromotionEligible(opts: {
  corpClassification: string | null;
  promotionBaseDate: Date | null;
  routeCreatedAt: Date;
  requestType: string;
}): boolean {
  if (opts.corpClassification !== "PARTNER") return false;
  if (!opts.promotionBaseDate) return false;
  if (opts.routeCreatedAt < opts.promotionBaseDate) return false;
  if (opts.requestType !== "신규") return false;
  return true;
}

export function promotionExpiresAt(routeCreatedAt: Date): Date {
  const d = new Date(routeCreatedAt);
  d.setMonth(d.getMonth() + PROMOTION_DURATION_MONTHS);
  return d;
}

export function isWithinPromotionPeriod(
  routeCreatedAt: Date,
  now: Date = new Date(),
): boolean {
  return now <= promotionExpiresAt(routeCreatedAt);
}

export function promotionRemainingDays(
  routeCreatedAt: Date,
  now: Date = new Date(),
): number | null {
  const expires = promotionExpiresAt(routeCreatedAt);
  if (now > expires) return null;
  return Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
