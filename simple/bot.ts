/**
 * 텔레그램 인터랙티브 봇 — 사장님 명령어로 매출 즉시 조회
 *
 * 명령어:
 *   /도움말           명령어 안내
 *   /오늘             오늘 매출
 *   /어제             어제 매출
 *   /이번주           이번주 누적
 *   /지난주           지난주
 *   /이번달           이번달 누적
 *   /지난달           지난달
 *   /매출 YYYY-MM-DD              특정 날짜
 *   /매출 YYYY-MM-DD YYYY-MM-DD   기간
 *   /검색 끌로에                  키워드 매출 (전체기간)
 *   /검색 끌로에 2026-04           키워드 + 해당 월
 *
 * 실행:
 *   npx tsx bot.ts          # 폴링 시작 (장시간 실행)
 *   systemd 로 service 등록 권장 — 서버 재부팅 시 자동 시작
 */

import "dotenv/config";
import { readRange, loadCredsFromEnv, type SheetCreds } from "./sheets";

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const SHEET_CREDS: SheetCreds | null = loadCredsFromEnv();

if (!TG_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN 누락");
if (!TG_CHAT) throw new Error("TELEGRAM_CHAT_ID 누락");
if (!SHEET_CREDS) throw new Error("Google Sheet 환경변수 누락");

const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
const KST_OFFSET = 9 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const won = (n: number) => n.toLocaleString("ko-KR") + "원";

// ─────────────────── 시간 helpers (KST 기준)

function ymdKst(d: Date): string {
  const kst = new Date(d.getTime() + KST_OFFSET);
  return kst.toISOString().slice(0, 10);
}
function todayKst(): string {
  return ymdKst(new Date());
}
function addDaysKst(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
function startOfWeekKst(s: string): string {
  // 월요일 시작
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun, 1=Mon, ...
  const monOffset = dow === 0 ? -6 : 1 - dow;
  return addDaysKst(s, monOffset);
}
function startOfMonthKst(s: string): string {
  return s.slice(0, 7) + "-01";
}
function endOfMonthKst(s: string): string {
  const [y, m] = s.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${s.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}
function previousMonthKst(s: string): string {
  const [y, m] = s.split("-").map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
}

// ─────────────────── 시트 데이터 읽기 + 필터/집계

interface OrderRow {
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

function isCanceledStatus(s: string): boolean {
  return /취소|반품|환불|cancel|refund|return/i.test(s);
}
function n(v: unknown): number {
  const x = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
}

let cachedRows: OrderRow[] | null = null;
let cacheTs = 0;
const CACHE_MS = 60_000; // 1분 캐시

async function loadAllOrders(): Promise<OrderRow[]> {
  if (cachedRows && Date.now() - cacheTs < CACHE_MS) return cachedRows;
  const rows = await readRange(SHEET_CREDS!, "주문원본!A2:R100000");
  const parsed: OrderRow[] = rows.map((r) => ({
    paymentDate: String(r[0] ?? ""),
    store: String(r[1] ?? ""),
    orderId: String(r[2] ?? ""),
    productOrderId: String(r[3] ?? ""),
    channelProductNo: String(r[4] ?? ""),
    productName: String(r[5] ?? ""),
    optionName: String(r[6] ?? ""),
    keyword: String(r[7] ?? ""),
    quantity: n(r[8]),
    bottles: n(r[9]),
    salesAmount: n(r[10]),
    commission: n(r[11]),
    settlement: n(r[12]),
    status: String(r[13] ?? ""),
    buyer: String(r[14] ?? ""),
    cost: n(r[15]),
    logistics: n(r[16]),
    profit: n(r[17]),
    isCanceled: isCanceledStatus(String(r[13] ?? "")),
  }));
  cachedRows = parsed;
  cacheTs = Date.now();
  return parsed;
}

function filterByDateRange(rows: OrderRow[], fromYmd: string, toYmd: string): OrderRow[] {
  return rows.filter((r) => {
    const d = r.paymentDate.slice(0, 10);
    return d >= fromYmd && d <= toYmd;
  });
}

function filterByText(rows: OrderRow[], q: string): OrderRow[] {
  const lower = q.toLowerCase();
  return rows.filter((r) =>
    `${r.productName} ${r.optionName} ${r.keyword}`.toLowerCase().includes(lower),
  );
}

// ─────────────────── 보고서 포맷

interface RangeReport {
  rows: OrderRow[];
  fromYmd: string;
  toYmd: string;
  title: string;
}

function formatReport({ rows, fromYmd, toYmd, title }: RangeReport): string {
  const live = rows.filter((r) => !r.isCanceled);
  const canceled = rows.filter((r) => r.isCanceled);
  const liveSales = live.reduce((s, r) => s + r.salesAmount, 0);
  const cancelSales = canceled.reduce((s, r) => s + r.salesAmount, 0);
  const profit = live.reduce((s, r) => s + r.profit, 0);

  const lines: string[] = [];
  lines.push(`<b>📊 ${title}</b>`);
  lines.push(`기간: ${fromYmd} ~ ${toYmd}`);
  lines.push("");
  if (rows.length === 0) {
    lines.push("매출 없음.");
    return lines.join("\n");
  }
  lines.push(`💰 전체매출 ${won(liveSales + cancelSales)} (${rows.length}건)`);
  if (canceled.length > 0) lines.push(`❌ 취소매출 -${won(cancelSales)} (${canceled.length}건)`);
  lines.push(`✅ <b>최종매출 ${won(liveSales)}</b> (${live.length}건)`);
  if (profit) lines.push(`💵 이익 ${won(profit)}`);
  lines.push("");

  // 스토어별
  const byStore = new Map<string, { live: OrderRow[]; canceled: OrderRow[] }>();
  for (const r of rows) {
    const cur = byStore.get(r.store) ?? { live: [], canceled: [] };
    if (r.isCanceled) cur.canceled.push(r);
    else cur.live.push(r);
    byStore.set(r.store, cur);
  }
  for (const [store, data] of byStore) {
    const sLiveSales = data.live.reduce((s, r) => s + r.salesAmount, 0);
    const sCancelSales = data.canceled.reduce((s, r) => s + r.salesAmount, 0);
    lines.push(`<b>━━ ${store} ━━</b>`);
    lines.push(`✅ ${won(sLiveSales)} (${data.live.length}건)`);
    if (data.canceled.length > 0) lines.push(`❌ -${won(sCancelSales)} (${data.canceled.length}건)`);

    const sBy = new Map<string, { keyword: string; bottles: number; sales: number; orderIds: Set<string> }>();
    for (const r of data.live) {
      const k = r.keyword || `(미분류)${r.productName.slice(0, 20)}`;
      const cur = sBy.get(k) ?? { keyword: k, bottles: 0, sales: 0, orderIds: new Set() };
      cur.bottles += r.bottles;
      cur.sales += r.salesAmount;
      cur.orderIds.add(r.orderId);
      sBy.set(k, cur);
    }
    const sSummary = Array.from(sBy.values()).sort((a, b) => b.sales - a.sales).slice(0, 10);
    for (const k of sSummary) {
      lines.push(`• <b>${k.keyword}</b>  ${k.bottles}개 · ${k.orderIds.size}건 · ${won(k.sales)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ─────────────────── 명령 핸들러

const HELP = `
<b>📋 매출 봇 명령어</b>

<b>━ 빠른 조회 ━</b>
/오늘
/어제
/이번주
/지난주
/이번달
/지난달

<b>━ 날짜 지정 ━</b>
/매출 2026-05-03
/매출 2026-05-01 2026-05-03

<b>━ 검색 ━</b>
/검색 끌로에
/검색 끌로에 2026-04

<b>━ 도움 ━</b>
/도움말
`.trim();

async function handleCommand(text: string, chatId: number): Promise<void> {
  const t = text.trim();

  if (t === "/start" || t === "/도움말" || t === "/help") {
    await sendMessage(chatId, HELP);
    return;
  }

  const today = todayKst();

  if (t === "/오늘") {
    const rows = filterByDateRange(await loadAllOrders(), today, today);
    await sendMessage(chatId, formatReport({ rows, fromYmd: today, toYmd: today, title: `오늘 (${today}) 매출` }));
    return;
  }
  if (t === "/어제") {
    const y = addDaysKst(today, -1);
    const rows = filterByDateRange(await loadAllOrders(), y, y);
    await sendMessage(chatId, formatReport({ rows, fromYmd: y, toYmd: y, title: `어제 (${y}) 매출` }));
    return;
  }
  if (t === "/이번주") {
    const start = startOfWeekKst(today);
    const rows = filterByDateRange(await loadAllOrders(), start, today);
    await sendMessage(chatId, formatReport({ rows, fromYmd: start, toYmd: today, title: "이번주 누적" }));
    return;
  }
  if (t === "/지난주") {
    const lastEnd = addDaysKst(startOfWeekKst(today), -1);
    const lastStart = startOfWeekKst(lastEnd);
    const rows = filterByDateRange(await loadAllOrders(), lastStart, lastEnd);
    await sendMessage(chatId, formatReport({ rows, fromYmd: lastStart, toYmd: lastEnd, title: "지난주 매출" }));
    return;
  }
  if (t === "/이번달") {
    const start = startOfMonthKst(today);
    const rows = filterByDateRange(await loadAllOrders(), start, today);
    await sendMessage(chatId, formatReport({ rows, fromYmd: start, toYmd: today, title: "이번달 누적" }));
    return;
  }
  if (t === "/지난달") {
    const lastM = previousMonthKst(today);
    const start = lastM;
    const end = endOfMonthKst(lastM);
    const rows = filterByDateRange(await loadAllOrders(), start, end);
    await sendMessage(chatId, formatReport({ rows, fromYmd: start, toYmd: end, title: `지난달 (${lastM.slice(0, 7)}) 매출` }));
    return;
  }

  // /매출 YYYY-MM-DD [YYYY-MM-DD]
  const mDate = t.match(/^\/매출\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{4}-\d{2}-\d{2}))?$/);
  if (mDate) {
    const from = mDate[1];
    const to = mDate[2] ?? mDate[1];
    const rows = filterByDateRange(await loadAllOrders(), from, to);
    await sendMessage(chatId, formatReport({ rows, fromYmd: from, toYmd: to, title: `매출 ${from}~${to}` }));
    return;
  }

  // /검색 키워드 [YYYY-MM]
  const mSearch = t.match(/^\/검색\s+(\S+)(?:\s+(\d{4}-\d{2}))?$/);
  if (mSearch) {
    const q = mSearch[1];
    const ym = mSearch[2];
    let rows = filterByText(await loadAllOrders(), q);
    let from = "0000-01-01";
    let to = "9999-12-31";
    if (ym) {
      from = ym + "-01";
      to = endOfMonthKst(from);
      rows = rows.filter((r) => {
        const d = r.paymentDate.slice(0, 10);
        return d >= from && d <= to;
      });
    }
    await sendMessage(chatId, formatReport({ rows, fromYmd: from, toYmd: to, title: `🔍 「${q}」 검색${ym ? ` (${ym})` : ""}` }));
    return;
  }

  await sendMessage(chatId, `❓ 명령 인식 안 됨: <code>${t}</code>\n\n${HELP}`);
}

// ─────────────────── Telegram API

interface TgUpdate {
  update_id: number;
  message?: { message_id: number; chat: { id: number }; text?: string };
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  const res = await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) console.error("sendMessage error:", res.status, await res.text());
}

async function pollUpdates(): Promise<void> {
  let offset = 0;
  console.log(`[bot] 시작. 인증 chat_id=${TG_CHAT}`);
  while (true) {
    try {
      const url = `${TG_API}/getUpdates?offset=${offset}&timeout=30`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error("getUpdates", res.status);
        await sleep(5000);
        continue;
      }
      const data = (await res.json()) as { ok: boolean; result: TgUpdate[] };
      for (const update of data.result) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg || !msg.text) continue;
        if (String(msg.chat.id) !== TG_CHAT) {
          console.warn(`[bot] 권한 없음: chat_id=${msg.chat.id}`);
          await sendMessage(msg.chat.id, "❌ 권한 없음");
          continue;
        }
        console.log(`[bot] ← ${msg.text}`);
        try {
          await handleCommand(msg.text, msg.chat.id);
        } catch (err) {
          console.error("handleCommand error:", err);
          await sendMessage(msg.chat.id, `❌ 오류: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      console.error("[bot] poll error:", err);
      await sleep(5000);
    }
  }
}

pollUpdates().catch((err) => {
  console.error("[bot] FATAL:", err);
  process.exit(1);
});
