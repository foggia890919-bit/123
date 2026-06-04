/**
 * 네이버 어제 주문을 스토어별로 직접 집계 (로컬 진단, 발송 X).
 * cd simple && npx tsx diag-naver.ts
 */
import "dotenv/config";
import bcrypt from "bcryptjs";

interface StoreConfig { name: string; clientId: string; clientSecret: string }
const STORES: StoreConfig[] = JSON.parse(process.env.NAVER_STORES_JSON ?? "[]");
const NAVER_BASE = "https://api.commerce.naver.com/external";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tokenCache = new Map<string, { token: string; exp: number }>();

async function getAccessToken(clientId: string, clientSecret: string) {
  const c = tokenCache.get(clientId);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const ts = Date.now();
  const sign = Buffer.from(bcrypt.hashSync(`${clientId}_${ts}`, clientSecret), "utf8").toString("base64");
  const body = new URLSearchParams({ client_id: clientId, timestamp: String(ts), grant_type: "client_credentials", client_secret_sign: sign, type: "SELF" });
  const res = await fetch(`${NAVER_BASE}/v1/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(clientId, { token: data.access_token, exp: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}
async function naverFetch(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${NAVER_BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json();
}
const KST = 9 * 3600 * 1000;
function prevDay() {
  const kst = new Date(Date.now() + KST);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate();
  return { fromIso: new Date(Date.UTC(y, m, d - 1) - KST).toISOString(), toIso: new Date(Date.UTC(y, m, d) - KST).toISOString(), dateStr: new Date(Date.UTC(y, m, d - 1)).toISOString().slice(0, 10) };
}
async function fetchOrders(store: StoreConfig, fromIso: string, toIso: string) {
  const token = await getAccessToken(store.clientId, store.clientSecret);
  const fromMs = new Date(fromIso).getTime();
  const toCap = Math.min(new Date(toIso).getTime() + 30 * 86400000, Date.now());
  const chunks: { from: string; to: string }[] = [];
  for (let c = fromMs; c < toCap; c += 86400000) chunks.push({ from: new Date(c).toISOString(), to: new Date(Math.min(c + 86400000, toCap)).toISOString() });
  const allIds = new Set<string>();
  for (let ci = 0; ci < chunks.length; ci++) {
    if (ci > 0) await sleep(1000);
    let cursor: string | undefined;
    for (let p = 0; p < 100; p++) {
      if (p > 0) await sleep(900);
      const params = new URLSearchParams({ lastChangedFrom: chunks[ci].from, lastChangedTo: chunks[ci].to });
      if (cursor) params.set("moreSequence", cursor);
      try {
        const data = await naverFetch(token, `/v1/pay-order/seller/product-orders/last-changed-statuses?${params}`);
        for (const row of data.data?.lastChangeStatuses ?? []) allIds.add(row.productOrderId);
        cursor = data.data?.more?.moreSequence;
        if (!cursor) break;
      } catch (e: any) { if (String(e.message).includes(" 429 ")) await sleep(30000); else break; }
    }
  }
  if (allIds.size === 0) return [];
  const idArr = [...allIds]; const raw: any[] = [];
  for (let i = 0; i < idArr.length; i += 300) {
    if (i > 0) await sleep(1500);
    const data = await naverFetch(token, `/v1/pay-order/seller/product-orders/query`, { method: "POST", body: JSON.stringify({ productOrderIds: idArr.slice(i, i + 300), quantityClaimCompatibility: true }) });
    for (const r of data.data ?? []) raw.push(r);
  }
  const seen = new Set<string>(); const out: any[] = [];
  const toMs = new Date(toIso).getTime();
  for (const r of raw) {
    const po = r.productOrder;
    if (seen.has(po.productOrderId)) continue; seen.add(po.productOrderId);
    const ds = po.paymentDate ?? r.order?.paymentDate; if (!ds) continue;
    const t = new Date(ds).getTime();
    if (t >= fromMs && t < toMs) out.push(r);
  }
  return out;
}
async function main() {
  const range = prevDay();
  console.log(`날짜: ${range.dateStr}`);
  for (const store of STORES) {
    try {
      const orders = await fetchOrders(store, range.fromIso, range.toIso);
      let sales = 0, qty = 0; const oids = new Set<string>();
      const byProd = new Map<string, any[]>();
      for (const o of orders) {
        const po = o.productOrder;
        const ch = po.channelProductNo ?? po.productId ?? "";
        (byProd.get(ch) ?? byProd.set(ch, []).get(ch)!).push(o);
        sales += po.totalPaymentAmount; qty += po.quantity; oids.add(o.order?.orderId ?? po.orderId ?? "");
      }
      console.log(`\n========== [${store.name}] 주문 ${orders.length}건 / 매출 ${sales.toLocaleString()} / 배송 ${oids.size}건 / 수량 ${qty} ==========`);
      const feeStats: Record<string, number> = {};
      for (const o of orders) { const f = String(o.productOrder.deliveryFeeAmount ?? "(필드없음)"); feeStats[f] = (feeStats[f] || 0) + 1; }
      console.log(`[${store.name}] deliveryFeeAmount 분포: ${JSON.stringify(feeStats)}`);
      // 배송비 0 인 주문 상세 (왜 0인지)
      const zeroFee = orders.filter((o) => (Number(o.productOrder.deliveryFeeAmount ?? 0) || 0) === 0);
      if (zeroFee.length > 0) {
        console.log(`[${store.name}] 배송비 0 주문 ${zeroFee.length}건:`);
        for (const o of zeroFee) {
          const po: any = o.productOrder;
          console.log(`   상품="${String(po.productName).slice(0, 20)}" opt="${po.productOption}" total=${po.totalPaymentAmount} 배송정책=${po.deliveryPolicyType} 배송비=${po.deliveryFeeAmount} 배송할인=${po.deliveryDiscountAmount}`);
        }
      }
      // 아보카도오일 12449037461 이익 분해
      const TARGET = "12449037461";
      const tgt = orders.filter((o) => (o.productOrder.channelProductNo ?? o.productOrder.productId) === TARGET);
      if (tgt.length > 0) {
        console.log(`\n=== [${TARGET}] 아보카도오일 ${tgt.length}건 이익 분해 ===`);
        let sumTotal = 0, sumSettle = 0, sumFee = 0, sumCostQty = 0;
        for (const o of tgt) {
          const po: any = o.productOrder;
          const total = po.totalPaymentAmount ?? 0;
          const settle = po.expectedSettlementAmount ?? po.settlementAmount ?? 0;
          const fee = po.deliveryFeeAmount ?? 0;
          const bottlesM = String(po.productOption ?? "").match(/(\d+)\s*병/);
          const bottles = bottlesM ? parseInt(bottlesM[1], 10) : po.quantity;
          sumTotal += total; sumSettle += settle; sumFee += fee; sumCostQty += bottles;
          console.log(`  opt="${po.productOption}" 매출${total} 정산${settle} 배송비${fee} 병수${bottles} 수수료${total - settle}`);
        }
        const cost = sumCostQty * 5000;       // 아보카도 원가 5000/병
        const logi = tgt.length * 4500;        // 물류 4500/건
        console.log(`  ─ 합계: 매출 ${sumTotal} / 정산 ${sumSettle} / 배송비 ${sumFee} / 총병수 ${sumCostQty}`);
        console.log(`  ─ 원가(5000x${sumCostQty})=${cost} / 물류(4500x${tgt.length})=${logi} / 수수료=${sumTotal - sumSettle}`);
        console.log(`  ─ 이익 = 정산${sumSettle} - 원가${cost} - 물류${logi} + 배송비${sumFee} = ${sumSettle - cost - logi + sumFee}`);
      }
      if (orders.length > 0) {
        const flat = JSON.stringify(orders[0]);
        console.log("=== 배송비/delivery/shipping 관련 필드 ===");
        for (const m of flat.matchAll(/"([A-Za-z]*(?:[Ff]ee|[Dd]elivery|[Ss]hipping)[A-Za-z]*)"\s*:\s*("?[^",}]*"?)/g)) {
          console.log(`  ${m[1]} = ${m[2]}`);
        }
        console.log("=== *Amount 필드 전체 ===");
        for (const m of flat.matchAll(/"([A-Za-z]*[Aa]mount)"\s*:\s*(-?[0-9]+)/g)) {
          console.log(`  ${m[1]} = ${m[2]}`);
        }
        console.log("=== /RAW ===\n");
      }
      for (const [ch, os] of byProd) {
        let s = 0; for (const o of os) s += o.productOrder.totalPaymentAmount;
        console.log(` [${ch}] ${String(os[0].productOrder.productName).slice(0, 40)} — ${os.length}건 ${s.toLocaleString()}`);
        for (const o of os) {
          const po = o.productOrder;
          console.log(`     opt="${po.productOption ?? ""}" / qty=${po.quantity} / amt=${po.totalPaymentAmount}`);
        }
      }
    } catch (e: any) {
      console.error(`[${store.name}] 실패: ${e.message}`);
    }
    await sleep(2000);
  }
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
