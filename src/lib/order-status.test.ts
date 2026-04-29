import { describe, it, expect } from "vitest";
import { isRevenueStatus } from "./order-status";

describe("isRevenueStatus", () => {
  it.each([
    ["PAYED", null, true],
    ["DELIVERING", null, true],
    ["DELIVERED", null, true],
    ["PURCHASE_DECIDED", null, true],
    ["CANCELED", null, false],
    ["CANCELLED", null, false],
    ["RETURNED", null, false],
    ["REFUNDED", null, false],
    [null, "취소", false],
    [null, "반품", false],
    [null, "환불", false],
    ["DELIVERED", "취소요청", false],
    [null, null, true],
  ] as [string | null, string | null, boolean][])("%s / %s -> %s", (s, d, expected) => {
    expect(isRevenueStatus(s, d)).toBe(expected);
  });
});
