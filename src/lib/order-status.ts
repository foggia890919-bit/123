/**
 * 네이버 주문 상태 분류.
 * 매출/이익 집계에서 제외할 상태 목록.
 */

export const REFUND_OR_CANCELED_STATUSES: ReadonlySet<string> = new Set([
  "CANCELED",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
  "REFUND_REQUESTED",
  "취소",
  "반품",
  "환불",
]);

export function isRevenueStatus(status: string | null | undefined, detailStatus?: string | null): boolean {
  const s = (status ?? "").toUpperCase().trim();
  const d = (detailStatus ?? "").toUpperCase().trim();
  if (REFUND_OR_CANCELED_STATUSES.has(s)) return false;
  if (REFUND_OR_CANCELED_STATUSES.has(d)) return false;
  // detailStatus 가 한글이거나 부분 매칭 — 「취소」, 「반품」, 「환불」
  if (/취소|반품|환불|cancel|refund|return/i.test(`${status ?? ""} ${detailStatus ?? ""}`)) return false;
  return true;
}
