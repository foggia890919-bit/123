/**
 * 「상품별집계」 — 상품번호 한 줄, 월별.
 *
 * 「주문원본」에 쌓인 데이터를 다시 읽어 계산하므로 백필·취소가 자동으로 반영된다.
 * run.ts(매일 아침)가 그 달을 갱신하고, 아래 CLI 로 과거 달도 뽑을 수 있다.
 *
 * CLI: npx tsx productsummary.ts 2026-08          (한 달)
 *      npx tsx productsummary.ts 2026-06 2026-08  (범위: 시작~끝)
 */

import "dotenv/config";
import { ensureTab, readRange, upsertRows, loadCredsFromEnv, type SheetCreds } from "./sheets";

export const PRODUCT_SUMMARY_TAB = "상품별집계";
export const PRODUCT_SUMMARY_HEADERS = [
  "월", "상품번호", "상품명", "판매건수", "수량",
  "매출", "수수료", "수취배송비", "원가합", "배송원가합",
  "실이익", "이익률", "설정상태",
];
export const SETUP_NEEDED = "설정 필요";

/** 「주문원본」 마지막 칼럼 (S = 수취배송비). */
const RAW_LAST_COL = "S";

const isCanceled = (s: string) => /취소|반품|환불|cancel|refund|return/i.test(s);

export interface MissingCostProduct {
  channelProductNo: string;
  productName: string;
  sales: number;
}

/**
 * @param yearMonth "YYYY-MM"
 * @returns 원가 미설정 상품 (매출 큰 순) — 알림용
 */
export async function updateProductSummary(
  c: SheetCreds,
  yearMonth: string,
): Promise<MissingCostProduct[]> {
  const rows = await readRange(c, `주문원본!A2:${RAW_LAST_COL}100000`);
  const num = (v: unknown) => Number(String(v ?? "").replace(/,/g, "")) || 0;

  interface Agg {
    productName: string;
    orderIds: Set<string>;
    qty: number; sales: number; commission: number; delivery: number;
    cost: number; logistics: number; profit: number;
    missing: boolean;
  }
  const byProduct = new Map<string, Agg>();

  for (const r of rows) {
    if (!String(r[0] ?? "").startsWith(yearMonth)) continue;
    if (isCanceled(String(r[13] ?? ""))) continue;   // 취소건 제외
    const chNo = String(r[4] ?? "").trim();
    if (!chNo) continue;
    const a = byProduct.get(chNo) ?? {
      productName: String(r[5] ?? "").slice(0, 40),
      orderIds: new Set<string>(),
      qty: 0, sales: 0, commission: 0, delivery: 0, cost: 0, logistics: 0, profit: 0,
      missing: false,
    };
    a.orderIds.add(String(r[2] ?? ""));
    a.qty += num(r[8]);
    a.sales += num(r[10]);
    a.commission += num(r[11]);
    a.delivery += num(r[18]);
    a.logistics += num(r[16]);
    // 「설정 필요」는 숫자가 아니므로 합산하지 않고 플래그만 세운다 (0 으로 계산하면 이익이 부풀려짐)
    if (String(r[15] ?? "").trim() === SETUP_NEEDED) a.missing = true;
    else a.cost += num(r[15]);
    if (String(r[17] ?? "").trim() === SETUP_NEEDED) a.missing = true;
    else a.profit += num(r[17]);
    byProduct.set(chNo, a);
  }

  // 과거에 쌓인 행은 원가가 「설정 필요」 문자열이 아니라 숫자 0 으로 들어가 있다.
  // 매출은 있는데 원가 합이 0 이면 그건 원가를 안 넣은 것 — 이익이 매출만큼 부풀려 보이므로
  // 똑같이 「설정 필요」로 잡는다.
  for (const [, a] of byProduct) {
    if (a.sales > 0 && a.cost === 0) a.missing = true;
  }

  const sorted = [...byProduct.entries()].sort((x, y) => y[1].sales - x[1].sales);
  const out: (string | number)[][] = sorted.map(([chNo, a]) => [
    yearMonth, chNo, a.productName, a.orderIds.size, a.qty,
    a.sales, a.commission, a.delivery,
    a.missing ? SETUP_NEEDED : a.cost,
    a.logistics,
    a.missing ? SETUP_NEEDED : a.profit,
    a.missing ? SETUP_NEEDED : (a.sales > 0 ? `${((a.profit / a.sales) * 100).toFixed(1)}%` : ""),
    a.missing ? SETUP_NEEDED : "OK",
  ]);

  await ensureTab(c, PRODUCT_SUMMARY_TAB, PRODUCT_SUMMARY_HEADERS);
  if (out.length > 0) {
    await upsertRows(c, PRODUCT_SUMMARY_TAB, out, (r) => `${r[0]}|${r[1]}`);
  }
  console.log(`✅ 「${PRODUCT_SUMMARY_TAB}」 ${yearMonth}: 상품 ${out.length}개 (원가 미설정 ${sorted.filter(([, a]) => a.missing).length}개)`);

  return sorted
    .filter(([, a]) => a.missing)
    .map(([chNo, a]) => ({ channelProductNo: chNo, productName: a.productName, sales: a.sales }));
}

/** 월 범위 전개 ("2026-06", "2026-08" → 06,07,08) */
function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// CLI 로 직접 실행했을 때만 동작 (run.ts 가 import 할 때는 안 돎)
if (process.argv[1] && /productsummary\.ts$/.test(process.argv[1])) {
  const creds = loadCredsFromEnv();
  if (!creds) throw new Error("시트 자격증명 없음");
  const from = process.argv[2];
  const to = process.argv[3] ?? from;
  if (!from) {
    console.error("사용법: npx tsx productsummary.ts YYYY-MM [YYYY-MM]");
    process.exit(1);
  }
  const months = monthRange(from, to);
  (async () => {
    for (const ym of months) await updateProductSummary(creds, ym);
    console.log("✅ 완료");
  })().catch((err) => {
    console.error("FATAL:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
