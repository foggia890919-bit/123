/**
 * 사장님 개인용 — 매일 09시 매출 보고.
 *
 * 흐름:
 *   1. Naver API 로 어제 결제건 모두 수집 (multi-type + 페이지네이션 + orderId 재조회)
 *   2. Google Sheet 「주문원본」 탭에 raw 행 append
 *   3. Sheet 「옵션매핑」 탭 읽어서 키워드 룰 로드 (없으면 코드 기본값)
 *   4. 매핑 적용 → 키워드별 집계 → Sheet 「일일집계」 탭 append
 *   5. 텔레그램 발송
 *
 * 환경변수 (.env):
 *   NAVER_STORES_JSON     '[{"name":"...","clientId":"...","clientSecret":"$2a$..."}]'
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *   GOOGLE_SHEETS_ID                    (선택 — 시트 안 쓰면 비워둠)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL        (선택)
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  (선택, JSON 의 private_key 값. \n 그대로)
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import {
  applyCancelRedRule,
  ensureTab,
  readRange,
  loadCredsFromEnv,
  upsertRows,
  type SheetCreds,
} from "./sheets";

// ─────────────────── 설정
interface StoreConfig {
  name: string;
  clientId: string;
  clientSecret: string;
}

const STORES: StoreConfig[] = JSON.parse(process.env.NAVER_STORES_JSON ?? "[]");
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const SHEET_CREDS: SheetCreds | null = loadCredsFromEnv();

// 시트 「옵션매핑」 탭 없을 때 사용할 코드 기본값
interface Rule {
  pattern: string;
  keyword: string;
  costPerUnit: number;
  logisticsPerOrder: number;
}
const DEFAULT_RULES: Rule[] = [
  { pattern: "피쿠알", keyword: "피쿠알", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "picual", keyword: "피쿠알", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "아르베키나", keyword: "아르베키나", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "arbequina", keyword: "아르베키나", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "블렌딩", keyword: "블렌딩", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "blending", keyword: "블렌딩", costPerUnit: 0, logisticsPerOrder: 0 },
];

// ─────────────────── 시간 (KST)
const KST_OFFSET = 9 * 60 * 60 * 1000;

function previousDayKstRange(now: Date = new Date()): { fromIso: string; toIso: string; dateStr: string } {
  const kst = new Date(now.getTime() + KST_OFFSET);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate();
  const start = Date.UTC(y, m, d - 1) - KST_OFFSET;
  const end = Date.UTC(y, m, d) - KST_OFFSET;
  return {
    fromIso: new Date(start).toISOString(),
    toIso: new Date(end).toISOString(),
    dateStr: new Date(Date.UTC(y, m, d - 1)).toISOString().slice(0, 10),
  };
}

function dateKstRange(s: string): { fromIso: string; toIso: string; dateStr: string } {
  const [y, m, d] = s.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d) - KST_OFFSET;
  const end = Date.UTC(y, m - 1, d + 1) - KST_OFFSET;
  return { fromIso: new Date(start).toISOString(), toIso: new Date(end).toISOString(), dateStr: s };
}

// ─────────────────── Naver API
const NAVER_BASE = "https://api.commerce.naver.com/external";
const tokenCache = new Map<string, { token: string; exp: number }>();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const cached = tokenCache.get(clientId);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const ts = Date.now();
  const sign = Buffer.from(bcrypt.hashSync(`${clientId}_${ts}`, clientSecret), "utf8").toString("base64");
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
    unitPrice: number;
    totalPaymentAmount: number;
    productOrderStatus?: string;
    knowledgeShoppingSellingInterlockCommission?: number;
    payCommissionAmount?: number;
    settlementAmount?: number;
    settleAmount?: number;
    expectedSettlementAmount?: number;
    paymentDate?: string;
    channelProductNo?: string;
    productId?: string;
  };
  order?: { orderId: string; ordererName?: string; paymentDate?: string };
}

async function fetchOrdersForDay(store: StoreConfig, fromIso: string, toIso: string): Promise<BulkOrder[]> {
  const token = await getAccessToken(store.clientId, store.clientSecret);

  // Naver last-changed-statuses 는 최대 24시간 창. 결제일 이후 30일까지 (또는 NOW 까지)
  // 상태변경된 주문도 캐치하기 위해 24시간씩 청크로 쪼개서 호출.
  const lastChangedFromMs = new Date(fromIso).getTime();
  const lastChangedToMs = Math.min(
    new Date(toIso).getTime() + 30 * 24 * 60 * 60 * 1000,
    Date.now(),
  );
  const dayMs = 24 * 60 * 60 * 1000;
  const chunks: { from: string; to: string }[] = [];
  for (let cur = lastChangedFromMs; cur < lastChangedToMs; cur += dayMs) {
    const next = Math.min(cur + dayMs, lastChangedToMs);
    chunks.push({
      from: new Date(cur).toISOString(),
      to: new Date(next).toISOString(),
    });
  }

  const allIds = new Set<string>();
  const orderIds = new Set<string>();

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    if (ci > 0) await sleep(1500);
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      if (page > 0) await sleep(1200);
      const params = new URLSearchParams({
        lastChangedFrom: chunk.from,
        lastChangedTo: chunk.to,
      });
      if (cursor) params.set("moreSequence", cursor);
      try {
        const data = await naverFetch<{
          data?: {
            lastChangeStatuses?: { productOrderId: string; orderId: string }[];
            more?: { moreSequence?: string };
          };
        }>(token, `/v1/pay-order/seller/product-orders/last-changed-statuses?${params}`);
        for (const row of data.data?.lastChangeStatuses ?? []) {
          allIds.add(row.productOrderId);
          orderIds.add(row.orderId);
        }
        cursor = data.data?.more?.moreSequence;
        if (!cursor) break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes(" 429 ")) {
          console.warn(`[${store.name}] RATE_LIMIT — 30초 대기`);
          await sleep(30_000);
        } else {
          console.warn(`[${store.name}] chunk ${ci + 1}/${chunks.length}: ${msg.slice(0, 100)}`);
        }
        break;
      }
    }
  }
  console.log(`[${store.name}] step1 (${chunks.length}청크): productOrderIds=${allIds.size}, orderIds=${orderIds.size}`);

  // Step 2: orderId 별 productOrderId 재조회 (형제 productOrder 누락 방지)
  if (orderIds.size > 0 && orderIds.size <= 500) {
    let added = 0;
    for (const oid of orderIds) {
      await sleep(500);
      try {
        const data = await naverFetch<{ data?: { productOrderIds?: string[]; contents?: { productOrderId: string }[] } }>(
          token,
          `/v1/pay-order/seller/orders/${oid}/product-order-ids`,
        );
        const ids = data.data?.productOrderIds
          ?? data.data?.contents?.map((c) => c.productOrderId)
          ?? [];
        for (const id of ids) {
          if (!allIds.has(id)) {
            allIds.add(id);
            added += 1;
          }
        }
      } catch {
        // 일부 실패는 무시
      }
    }
    console.log(`[${store.name}] step2 재조회 +${added}건 → 누적 ${allIds.size}`);
  }

  if (allIds.size === 0) return [];

  // Step 3: bulk 상세 조회 (300개 단위)
  const idArr = Array.from(allIds);
  const raw: BulkOrder[] = [];
  for (let i = 0; i < idArr.length; i += 300) {
    if (i > 0) await sleep(1500);
    const slice = idArr.slice(i, i + 300);
    const data = await naverFetch<{ data?: BulkOrder[] }>(token, `/v1/pay-order/seller/product-orders/query`, {
      method: "POST",
      body: JSON.stringify({ productOrderIds: slice, quantityClaimCompatibility: true }),
    });
    for (const row of data.data ?? []) raw.push(row);
  }

  // Step 4: paymentDate 가 윈도우 안인 것만 + productOrderId 기준 dedup
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const seenPids = new Set<string>();
  const out: BulkOrder[] = [];
  for (const row of raw) {
    const pid = row.productOrder.productOrderId;
    if (seenPids.has(pid)) continue;
    seenPids.add(pid);
    const dateStr = row.productOrder.paymentDate ?? row.order?.paymentDate;
    if (!dateStr) continue;
    const t = new Date(dateStr).getTime();
    if (t >= fromMs && t < toMs) out.push(row);
  }
  console.log(`[${store.name}] bulk ${raw.length} → 결제일 필터 ${out.length}개`);
  return out;
}

// ─────────────────── 키워드 매핑
async function loadRules(): Promise<Rule[]> {
  // 시트 「옵션매핑」 (A=패턴, B=키워드, C=원가(개당), D=물류비(개당)) 우선, 없으면 코드 기본값
  if (!SHEET_CREDS) return DEFAULT_RULES;
  try {
    await ensureTab(SHEET_CREDS, "옵션매핑", ["패턴", "키워드", "원가(개당)", "물류비(건당)"]);
    const rows = await readRange(SHEET_CREDS, "옵션매핑!A2:D10000");
    const fromSheet = rows
      .filter((r) => r[0] && r[1])
      .map((r) => ({
        pattern: String(r[0]),
        keyword: String(r[1]),
        costPerUnit: Number(String(r[2] ?? "").replace(/,/g, "")) || 0,
        logisticsPerOrder: Number(String(r[3] ?? "").replace(/,/g, "")) || 0,
      }));
    if (fromSheet.length > 0) {
      console.log(`시트 옵션매핑 ${fromSheet.length}개 로드`);
      return [...fromSheet, ...DEFAULT_RULES];
    }
  } catch (err) {
    console.warn("옵션매핑 시트 읽기 실패:", err instanceof Error ? err.message : String(err));
  }
  return DEFAULT_RULES;
}

function classify(productName: string, option: string, rules: Rule[]): Rule | null {
  // 상품명 우선 매칭 (어떤 상품의 주문전환인지가 먼저).
  // 상품명에 매칭 없으면 옵션으로 fallback.
  const namelower = productName.toLowerCase();
  for (const r of rules) {
    if (namelower.includes(r.pattern.toLowerCase())) return r;
  }
  if (option) {
    const optlower = option.toLowerCase();
    for (const r of rules) {
      if (optlower.includes(r.pattern.toLowerCase())) return r;
    }
  }
  return null;
}

function extractBottles(text: string): number {
  const m = text.match(/(\d+)\s*(?:병|개|입|set|세트|팩)/i);
  return m ? parseInt(m[1], 10) : 1;
}

function isCanceled(status: string): boolean {
  return /취소|반품|환불|cancel|refund|return/i.test(status);
}

// ─────────────────── 텔레그램
const won = (n: number) => n.toLocaleString("ko-KR") + "원";

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

// ─────────────────── 메인
const RAW_HEADERS = [
  "결제일", "스토어", "주문번호", "상품주문번호", "상품번호",
  "상품명", "옵션", "키워드", "수량", "출고수량",
  "매출", "수수료", "정산예정", "상태", "구매자",
  "원가", "물류비", "이익",
];
const SUMMARY_HEADERS = ["보고일", "키워드", "출고수량", "수량", "건수", "매출", "수수료"];

interface Row {
  paymentDate: string;
  store: string;
  orderId: string;
  productOrderId: string;
  channelProductNo: string;
  productName: string;
  optionName: string;
  keyword: string;
  quantity: number;
  bottles: number;
  salesAmount: number;
  commission: number;
  settlement: number;
  status: string;
  buyer: string;
  cost: number;
  logistics: number;
  profit: number;
  isCanceled: boolean;
}

interface ProcessOptions {
  sendTelegram: boolean;
}

async function processDay(
  range: { fromIso: string; toIso: string; dateStr: string },
  rules: Rule[],
  options: ProcessOptions,
): Promise<void> {
  console.log(`\n[${range.dateStr}] ${options.sendTelegram ? '메인 보고' : '시트 동기화 only'}`);
  const allRows: Row[] = [];
  const errors: string[] = [];

  for (let si = 0; si < STORES.length; si++) {
    if (si > 0) await sleep(3000);
    const store = STORES[si];
    try {
      console.log(`[${store.name}] 시작…`);
      const orders = await fetchOrdersForDay(store, range.fromIso, range.toIso);
      for (const o of orders) {
        const po = o.productOrder;
        const matched = classify(po.productName, po.productOption ?? "", rules);
        const perUnitBottles = extractBottles(po.productOption ?? po.productName);
        const totalUnits = po.quantity * perUnitBottles;
        const commission =
          (po.knowledgeShoppingSellingInterlockCommission ?? 0) + (po.payCommissionAmount ?? 0);
        const settlement =
          po.expectedSettlementAmount
          ?? po.settlementAmount
          ?? po.settleAmount
          ?? (po.totalPaymentAmount - commission);
        const cost = (matched?.costPerUnit ?? 0) * totalUnits;
        const logistics = matched?.logisticsPerOrder ?? 0; // 건당 (행 1건에 1번)
        const profit = settlement - cost - logistics;
        allRows.push({
          paymentDate: po.paymentDate ?? o.order?.paymentDate ?? "",
          store: store.name,
          orderId: o.order?.orderId ?? po.orderId ?? "",
          productOrderId: po.productOrderId,
          channelProductNo: po.channelProductNo ?? po.productId ?? "",
          productName: po.productName,
          optionName: po.productOption ?? "",
          keyword: matched?.keyword ?? "",
          quantity: po.quantity,
          bottles: totalUnits,
          salesAmount: po.totalPaymentAmount,
          commission,
          settlement,
          status: po.productOrderStatus ?? "",
          buyer: o.order?.ordererName ?? "",
          cost,
          logistics,
          profit,
          isCanceled: isCanceled(po.productOrderStatus ?? ""),
        });
      }
      console.log(`[${store.name}] ${orders.length}건 정규화`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${store.name}] 실패: ${msg}`);
      errors.push(`${store.name}: ${msg}`);
    }
  }

  // 시트 입력 (있으면)
  if (SHEET_CREDS && allRows.length > 0) {
    try {
      await ensureTab(SHEET_CREDS, "주문원본", RAW_HEADERS);
      // 상태(N열, index 13) 가 취소/반품/환불 이면 행 빨간 글씨
      try {
        await applyCancelRedRule(SHEET_CREDS, "주문원본", 13, RAW_HEADERS.length);
      } catch (err) {
        console.warn("조건부서식 적용 실패:", err instanceof Error ? err.message : String(err));
      }
      const rawRows: (string | number)[][] = allRows.map((r) => [
        r.paymentDate, r.store, r.orderId, r.productOrderId, r.channelProductNo,
        r.productName, r.optionName, r.keyword, r.quantity, r.bottles,
        r.salesAmount, r.commission, r.isCanceled ? "" : r.settlement, r.status, r.buyer,
        r.isCanceled ? "" : r.cost,
        r.isCanceled ? "" : r.logistics,
        r.isCanceled ? "" : r.profit,
      ]);
      // 상품주문번호(D열, idx 3) 기준 upsert. 이미 있으면 갱신, 중복 자동 정리.
      const result = await upsertRows(
        SHEET_CREDS,
        "주문원본",
        rawRows,
        (r) => String(r[3] ?? ""),
      );
      console.log(
        `✅ 「주문원본」: 신규 ${result.appended} / 갱신 ${result.updated}` +
          (result.deduped > 0 ? ` / 중복정리 ${result.deduped}` : ""),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("시트 「주문원본」 쓰기 실패:", msg);
      errors.push(`sheet: ${msg}`);
    }
  } else if (!SHEET_CREDS) {
    console.log("(시트 미설정 — 시트 입력 스킵)");
  }

  // 집계
  const live = allRows.filter((r) => !r.isCanceled);
  const canceled = allRows.filter((r) => r.isCanceled);

  const byKeyword = new Map<
    string,
    { keyword: string; qty: number; bottles: number; sales: number; commission: number; orderIds: Set<string> }
  >();
  for (const r of live) {
    const k = r.keyword || `(미분류)${r.productName.slice(0, 20)}`;
    const cur = byKeyword.get(k) ?? { keyword: k, qty: 0, bottles: 0, sales: 0, commission: 0, orderIds: new Set() };
    cur.qty += r.quantity;
    cur.bottles += r.bottles;
    cur.sales += r.salesAmount;
    cur.commission += r.commission;
    cur.orderIds.add(r.orderId);
    byKeyword.set(k, cur);
  }
  const summary = Array.from(byKeyword.values()).sort((a, b) => b.sales - a.sales);

  // 취소건도 키워드별 집계 (별도)
  const byKeywordCanceled = new Map<
    string,
    { keyword: string; qty: number; bottles: number; sales: number; orderIds: Set<string> }
  >();
  for (const r of canceled) {
    const k = r.keyword || `(미분류)${r.productName.slice(0, 20)}`;
    const cur = byKeywordCanceled.get(k) ?? { keyword: k, qty: 0, bottles: 0, sales: 0, orderIds: new Set() };
    cur.qty += r.quantity;
    cur.bottles += r.bottles;
    cur.sales += r.salesAmount;
    cur.orderIds.add(r.orderId);
    byKeywordCanceled.set(k, cur);
  }
  const summaryCanceled = Array.from(byKeywordCanceled.values()).sort((a, b) => b.sales - a.sales);

  // 집계 시트도 입력 — (보고일+키워드) 기준 upsert
  if (SHEET_CREDS && summary.length > 0) {
    try {
      await ensureTab(SHEET_CREDS, "일일집계", SUMMARY_HEADERS);
      const sumRows = summary.map((r) => [
        range.dateStr, r.keyword, r.bottles, r.qty, r.orderIds.size, r.sales, r.commission,
      ]);
      const sumResult = await upsertRows(
        SHEET_CREDS,
        "일일집계",
        sumRows,
        (r) => `${r[0]}|${r[1]}`,
      );
      console.log(
        `✅ 「일일집계」: 신규 ${sumResult.appended} / 갱신 ${sumResult.updated}` +
          (sumResult.deduped > 0 ? ` / 중복정리 ${sumResult.deduped}` : ""),
      );
    } catch (err) {
      console.error("시트 「일일집계」 쓰기 실패:", err instanceof Error ? err.message : String(err));
    }
  }

  // 텔레그램
  const liveSales = live.reduce((s, r) => s + r.salesAmount, 0);
  const canceledSales = canceled.reduce((s, r) => s + r.salesAmount, 0);
  const grossSales = liveSales + canceledSales;
  const totalQty = live.reduce((s, r) => s + r.quantity, 0);
  const totalBottles = live.reduce((s, r) => s + r.bottles, 0);
  const totalShipments = new Set(live.map((r) => r.orderId)).size;
  const totalCommission = live.reduce((s, r) => s + r.commission, 0);

  const lines: string[] = [];
  lines.push(`<b>📊 ${range.dateStr} 매출 보고</b>`);
  lines.push("");
  lines.push(`💰 전체매출 ${won(grossSales)} (${allRows.length}건)`);
  if (canceled.length > 0) {
    lines.push(`❌ 취소매출 -${won(canceledSales)} (${canceled.length}건)`);
  }
  lines.push(`✅ <b>최종매출 ${won(liveSales)}</b> (${live.length}건)`);
  lines.push("");
  lines.push(`📦 ${totalShipments}건 배송 / 출고 ${totalBottles}개 / ${totalQty}개 품목`);
  lines.push(`💳 수수료 ${won(totalCommission)}`);
  lines.push("");

  if (summary.length === 0 && summaryCanceled.length === 0) {
    lines.push("매출 없음.");
  } else {
    if (summary.length > 0) {
      lines.push("<b>━━ 키워드별 (결제완료) ━━</b>");
      for (const r of summary) {
        lines.push(`• <b>${r.keyword}</b>\n   ${r.bottles}개 · ${r.orderIds.size}건 · ${won(r.sales)}`);
      }
    }
    if (summaryCanceled.length > 0) {
      if (summary.length > 0) lines.push("");
      lines.push("<b>━━ 키워드별 (취소) ━━</b>");
      for (const r of summaryCanceled) {
        lines.push(`• <s>${r.keyword}</s>\n   ${r.bottles}개 · ${r.orderIds.size}건 · -${won(r.sales)}`);
      }
    }
  }
  if (errors.length > 0) {
    lines.push("");
    lines.push("⚠️ <b>오류:</b>");
    for (const e of errors) lines.push(`• ${e.slice(0, 250)}`);
  }

  if (options.sendTelegram) {
    console.log("\n=== 미리보기 ===\n" + lines.join("\n").replace(/<[^>]+>/g, ""));
    await sendTelegram(lines.join("\n"));
  }
  console.log(`[${range.dateStr}] ✅ 완료`);
}

function previousDaysKstRanges(daysBack: number): { fromIso: string; toIso: string; dateStr: string }[] {
  const now = new Date();
  const kst = new Date(now.getTime() + KST_OFFSET);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate();
  const out: { fromIso: string; toIso: string; dateStr: string }[] = [];
  for (let i = 1; i <= daysBack; i++) {
    const start = Date.UTC(y, m, d - i) - KST_OFFSET;
    const end = Date.UTC(y, m, d - i + 1) - KST_OFFSET;
    out.push({
      fromIso: new Date(start).toISOString(),
      toIso: new Date(end).toISOString(),
      dateStr: new Date(Date.UTC(y, m, d - i)).toISOString().slice(0, 10),
    });
  }
  return out;
}

async function main() {
  if (STORES.length === 0) throw new Error("NAVER_STORES_JSON 비어있음");
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];
  const rules = await loadRules();
  console.log(`키워드 룰 ${rules.length}개`);

  // 범위 백필: `npx tsx run.ts 2026-04-01 2026-05-01` → 텔레그램 X, 시트만 갱신
  if (arg1 && arg2) {
    const m1 = arg1.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const m2 = arg2.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m1 || !m2) throw new Error("날짜 형식 오류 (YYYY-MM-DD 두 개)");
    // UTC 기준으로 날짜 ms 계산 — 타임존 영향 없이 일자 +1 가능
    const fromMs = Date.UTC(+m1[1], +m1[2] - 1, +m1[3]);
    const toMs = Date.UTC(+m2[1], +m2[2] - 1, +m2[3]);
    if (fromMs > toMs) throw new Error("시작일이 종료일보다 늦음");
    const dayMs = 24 * 60 * 60 * 1000;
    const days: string[] = [];
    for (let cur = fromMs; cur <= toMs; cur += dayMs) {
      days.push(new Date(cur).toISOString().slice(0, 10));
    }
    console.log(`범위 백필: ${days.length}일 (${arg1} ~ ${arg2}) — 텔레그램 발송 안 함`);
    for (let i = 0; i < days.length; i++) {
      console.log(`\n[${i + 1}/${days.length}] ${days[i]}`);
      try {
        await processDay(dateKstRange(days[i]), rules, { sendTelegram: false });
      } catch (err) {
        console.error(`[${days[i]}] 실패:`, err instanceof Error ? err.message : String(err));
      }
    }
    console.log(`\n✅ 범위 백필 완료: ${days.length}일`);
    return;
  }

  // 단일 날짜 백필: 텔레그램 발송
  if (arg1) {
    await processDay(dateKstRange(arg1), rules, { sendTelegram: true });
    return;
  }

  // 일상 cron: 7일 롤링
  // 1일째(어제) = 텔레그램 + 시트, 2~7일째 = 시트만 (취소/반품 상태변경 캐치)
  const ranges = previousDaysKstRanges(7);
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const sendTg = (i === 0);
    try {
      await processDay(range, rules, { sendTelegram: sendTg });
    } catch (err) {
      console.error(`[${range.dateStr}] 실패:`, err instanceof Error ? err.message : String(err));
    }
  }
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("FATAL:", msg);
  try {
    await sendTelegram(`❌ 매출 보고 실패\n<code>${msg}</code>`);
  } catch {}
  process.exit(1);
});
