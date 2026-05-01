/**
 * 사장님 개인용 — 매일 09시 텔레그램 매출 보고.
 *
 * 환경변수:
 *   NAVER_STORES_JSON  '[{"name":"비타앤오리진","clientId":"...","clientSecret":"$2a$04$..."}, ...]'
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *
 * 실행: `npx tsx run.ts`  (전일 결제 기준)
 *      `npx tsx run.ts 2026-04-25`  (특정 날짜 KST 기준)
 *
 * 단일 파일 ~280줄. DB·로그인·UI 없음. cron 1개로 동작.
 */

import "dotenv/config";
import bcrypt from "bcryptjs";

// ─────────────────────────────── 설정
interface StoreConfig {
  name: string;
  clientId: string;
  clientSecret: string;
}

interface KeywordRule {
  keyword: string;
  patterns: string[];
}

const STORES: StoreConfig[] = JSON.parse(process.env.NAVER_STORES_JSON ?? "[]");
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

// 옵션명 → 키워드 매칭 룰 (필요 시 여기 직접 수정)
const KEYWORD_RULES: KeywordRule[] = [
  { keyword: "피쿠알", patterns: ["피쿠알", "picual"] },
  { keyword: "아르베키나", patterns: ["아르베키나", "arbequina"] },
  { keyword: "블렌딩", patterns: ["블렌딩", "blending", "blend", "혼합"] },
];

const REFUND_KEYWORDS = ["취소", "반품", "환불", "CANCEL", "REFUND", "RETURN"];

// ─────────────────────────────── 시간 (KST)
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function previousDayKstRange(now: Date = new Date()): {
  fromIso: string;
  toIso: string;
  dateStr: string;
} {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MS);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  const startMs = Date.UTC(y, m, d - 1) - KST_OFFSET_MS;
  const endMs = Date.UTC(y, m, d) - KST_OFFSET_MS;
  return {
    fromIso: new Date(startMs).toISOString(),
    toIso: new Date(endMs).toISOString(),
    dateStr: new Date(Date.UTC(y, m, d - 1)).toISOString().slice(0, 10),
  };
}

function dateKstRange(dateStr: string): { fromIso: string; toIso: string; dateStr: string } {
  // dateStr = YYYY-MM-DD (KST)
  const [y, m, d] = dateStr.split("-").map(Number);
  const startMs = Date.UTC(y, m - 1, d) - KST_OFFSET_MS;
  const endMs = Date.UTC(y, m - 1, d + 1) - KST_OFFSET_MS;
  return {
    fromIso: new Date(startMs).toISOString(),
    toIso: new Date(endMs).toISOString(),
    dateStr,
  };
}

// ─────────────────────────────── Naver API
const NAVER_BASE = "https://api.commerce.naver.com/external";
const tokenCache = new Map<string, { token: string; exp: number }>();

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const cached = tokenCache.get(clientId);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;

  const ts = Date.now();
  const password = `${clientId}_${ts}`;
  const hashed = bcrypt.hashSync(password, clientSecret);
  const sign = Buffer.from(hashed, "utf8").toString("base64");

  const body = new URLSearchParams({
    client_id: clientId,
    timestamp: String(ts),
    grant_type: "client_credentials",
    client_secret_sign: sign,
    type: "SELF",
  });
  const res = await fetch(`${NAVER_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(clientId, { token: data.access_token, exp: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

async function naverFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${NAVER_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface BulkOrder {
  productOrder: {
    productOrderId: string;
    orderId?: string;
    productName: string;
    productOption?: string;
    quantity: number;
    totalPaymentAmount: number;
    productOrderStatus?: string;
    knowledgeShoppingSellingInterlockCommission?: number;
    payCommissionAmount?: number;
    paymentDate?: string;
    placeOrderDate?: string;
  };
  order?: { orderId: string; ordererName?: string };
}

async function fetchOrdersForDay(store: StoreConfig, fromIso: string, toIso: string): Promise<BulkOrder[]> {
  const token = await getAccessToken(store.clientId, store.clientSecret);

  // 1) 기간 내 모든 상태변경 productOrderId 수집 (필터 없이 + 페이지네이션)
  //    - lastChangedType 필터 없으면 PAYED/DISPATCHED 등 모든 변경 포함 → 결제 후 발송된 주문도 누락 X
  //    - moreSequence 로 다음 페이지 따라가며 전체 수집
  const allIds = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({
      lastChangedFrom: fromIso,
      lastChangedTo: toIso,
    });
    if (cursor) params.set("moreSequence", cursor);
    const data = await naverFetch<{
      data?: {
        lastChangeStatuses?: { productOrderId: string; orderId: string; lastChangedType?: string; productOrderStatus?: string }[];
        more?: { moreSequence?: string };
      };
    }>(token, `/v1/pay-order/seller/product-orders/last-changed-statuses?${params}`);
    for (const row of data.data?.lastChangeStatuses ?? []) {
      allIds.add(row.productOrderId);
    }
    cursor = data.data?.more?.moreSequence;
    if (!cursor) break;
  }
  if (allIds.size === 0) return [];

  // 2) 300개 단위로 bulk 상세 조회
  const ids = Array.from(allIds);
  const out: BulkOrder[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const slice = ids.slice(i, i + 300);
    const data = await naverFetch<{ data?: BulkOrder[] }>(
      token,
      `/v1/pay-order/seller/product-orders/query`,
      {
        method: "POST",
        body: JSON.stringify({ productOrderIds: slice, quantityClaimCompatibility: true }),
      },
    );
    for (const row of data.data ?? []) out.push(row);
  }
  return out;
}

// ─────────────────────────────── 집계
interface NormalizedItem {
  storeName: string;
  productName: string;
  optionName: string;
  keyword: string;
  bottles: number;
  quantity: number;
  salesAmount: number;
  commission: number;
  orderId: string;
  status: string;
}

function classify(text: string): { keyword: string; bottles: number } {
  for (const r of KEYWORD_RULES) {
    for (const p of r.patterns) {
      if (text.toLowerCase().includes(p.toLowerCase())) {
        const m = text.match(/(\d+)\s*(?:병|개|입|set|세트|팩)/i);
        return { keyword: r.keyword, bottles: m ? parseInt(m[1], 10) : 1 };
      }
    }
  }
  const m = text.match(/(\d+)\s*(?:병|개|입|set|세트|팩)/i);
  return { keyword: "", bottles: m ? parseInt(m[1], 10) : 1 };
}

function isCanceled(status: string): boolean {
  const u = status.toUpperCase();
  return REFUND_KEYWORDS.some((k) => u.includes(k.toUpperCase()));
}

function normalize(orders: BulkOrder[], storeName: string): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  for (const row of orders) {
    const po = row.productOrder;
    const optionName = po.productOption ?? "";
    const text = `${po.productName} ${optionName}`;
    const { keyword, bottles } = classify(text);
    out.push({
      storeName,
      productName: po.productName,
      optionName,
      keyword: keyword || po.productName,
      bottles: po.quantity * bottles,
      quantity: po.quantity,
      salesAmount: po.totalPaymentAmount,
      commission: (po.knowledgeShoppingSellingInterlockCommission ?? 0) + (po.payCommissionAmount ?? 0),
      orderId: row.order?.orderId ?? po.orderId ?? "",
      status: po.productOrderStatus ?? "",
    });
  }
  return out;
}

// ─────────────────────────────── 메시지 포맷
const won = (n: number) => n.toLocaleString("ko-KR") + "원";

function buildReport(items: NormalizedItem[], dateStr: string): string {
  const live = items.filter((it) => !isCanceled(it.status));
  const canceledCount = items.length - live.length;

  // (스토어, 키워드) 단위 집계
  const map = new Map<string, { storeName: string; keyword: string; quantity: number; bottles: number; sales: number; commission: number; orderIds: Set<string> }>();
  for (const it of live) {
    const k = `${it.storeName}::${it.keyword}`;
    const cur = map.get(k);
    if (cur) {
      cur.quantity += it.quantity;
      cur.bottles += it.bottles;
      cur.sales += it.salesAmount;
      cur.commission += it.commission;
      cur.orderIds.add(it.orderId);
    } else {
      map.set(k, {
        storeName: it.storeName,
        keyword: it.keyword,
        quantity: it.quantity,
        bottles: it.bottles,
        sales: it.salesAmount,
        commission: it.commission,
        orderIds: new Set([it.orderId]),
      });
    }
  }
  const rows = Array.from(map.values()).sort((a, b) => b.sales - a.sales);

  const totalSales = live.reduce((s, it) => s + it.salesAmount, 0);
  const totalQty = live.reduce((s, it) => s + it.quantity, 0);
  const totalShipments = new Set(live.map((it) => it.orderId)).size;
  const totalCommission = live.reduce((s, it) => s + it.commission, 0);

  const storeNames = Array.from(new Set(rows.map((r) => r.storeName)));

  const lines: string[] = [];
  lines.push(`<b>📊 ${dateStr} 매출 보고</b>`);
  lines.push("");
  lines.push(`💰 매출 <b>${won(totalSales)}</b>`);
  lines.push(`📦 ${totalShipments}건 배송 / ${rows.reduce((s, r) => s + r.bottles, 0)}병 / ${totalQty}개 품목`);
  lines.push(`💳 수수료 ${won(totalCommission)}`);
  if (canceledCount > 0) lines.push(`⚠️ 취소·반품·환불 ${canceledCount}건 제외`);
  lines.push("");

  if (rows.length === 0) {
    lines.push("매출 없음.");
  } else {
    lines.push("<b>━━ 키워드별 ━━</b>");
    for (const r of rows) {
      const storeLabel = storeNames.length > 1 ? ` <i>[${r.storeName}]</i>` : "";
      lines.push(
        `• <b>${r.keyword}</b>${storeLabel}\n` +
        `   ${r.bottles}병 · ${r.quantity}개 · ${r.orderIds.size}건 · ${won(r.sales)}`,
      );
    }
    if (storeNames.length > 1) {
      lines.push("");
      lines.push("<b>━━ 스토어별 ━━</b>");
      const byStore = new Map<string, { sales: number; orders: Set<string>; bottles: number }>();
      for (const it of live) {
        const cur = byStore.get(it.storeName) ?? { sales: 0, orders: new Set(), bottles: 0 };
        cur.sales += it.salesAmount;
        cur.bottles += it.bottles;
        cur.orders.add(it.orderId);
        byStore.set(it.storeName, cur);
      }
      for (const [name, v] of Array.from(byStore.entries()).sort((a, b) => b[1].sales - a[1].sales)) {
        lines.push(`• ${name} — ${won(v.sales)} · ${v.bottles}병 · ${v.orders.size}건`);
      }
    }
  }
  return lines.join("\n");
}

// ─────────────────────────────── 텔레그램
async function sendTelegram(text: string): Promise<void> {
  if (!TG_TOKEN || !TG_CHAT) {
    console.error("TELEGRAM 환경변수 누락");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
}

// ─────────────────────────────── 메인
async function main() {
  if (STORES.length === 0) throw new Error("NAVER_STORES_JSON 비어있음");
  const arg = process.argv[2];
  const range = arg ? dateKstRange(arg) : previousDayKstRange();

  const all: NormalizedItem[] = [];
  const errors: string[] = [];

  for (const store of STORES) {
    try {
      console.log(`[${store.name}] fetching ${range.fromIso} ~ ${range.toIso}…`);
      const orders = await fetchOrdersForDay(store, range.fromIso, range.toIso);
      const items = normalize(orders, store.name);
      console.log(`[${store.name}] ${items.length}건`);
      all.push(...items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${store.name}] 실패: ${msg}`);
      errors.push(`${store.name}: ${msg}`);
    }
  }

  let report = buildReport(all, range.dateStr);
  if (errors.length > 0) {
    report += `\n\n⚠️ <b>일부 스토어 오류:</b>\n${errors.map((e) => `• ${e}`).join("\n")}`;
  }

  console.log("\n=== 미리보기 ===\n" + report.replace(/<[^>]+>/g, ""));
  await sendTelegram(report);
  console.log("\n✅ 텔레그램 발송 완료");
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("FATAL:", msg);
  try {
    await sendTelegram(`❌ 매출 보고 실패\n<code>${msg}</code>`);
  } catch {}
  process.exit(1);
});
