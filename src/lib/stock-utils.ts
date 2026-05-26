/**
 * Sum `stock` values with null-propagation:
 * - If every item has `stock === null`, the result is `null`.
 * - Otherwise, null entries are skipped and the rest are summed.
 */
export function sumStockNullSafe(items: Array<{ stock: number | null }>): number | null {
  let sum: number | null = null;
  for (const item of items) {
    if (item.stock != null) {
      sum = (sum ?? 0) + item.stock;
    }
  }
  return sum;
}
