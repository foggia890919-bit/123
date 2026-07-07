/**
 * 네이버 쇼핑 검색순위 추적
 *
 * 「순위추적」 탭 구조 (A~D 는 사장님 관리, E 부터는 자동):
 *   A열: 사업자명 ← 비워두면 우리 스토어 전체 탐색 후 발견된 스토어명 자동 기입.
 *                   직접 적으면 그 판매처 상품만 추적 (우리 스토어 외 경쟁사 판매처명도 가능)
 *   B열: 키워드   ← 사장님이 입력 (검색량조회 탭의 키워드도 자동으로 새 행 추가됨)
 *   C열: MID     ← 특정 상품만 추적하고 싶으면 상품번호 입력 (스마트스토어 URL 끝 숫자)
 *   D열: 메모    ← 자유 메모 (스크립트가 건드리지 않음)
 *   E열~: 날짜별 순위 — 실행할 때마다 E열에 새 날짜가 끼어들고 과거는 오른쪽으로 밀림
 *          (E=오늘, F=어제, G=엊그제 …)
 *
 * 셀 표기:
 *   - MID 없는 행: 해당 스토어 상품 전부 → "1위 · 11위 · 13위" (상위 5개까지)
 *   - MID 있는 행: 그 상품의 순위만 → "13위"
 *   - 1,000위 안에 없으면 "순위밖"
 *
 * 「순위추적로그」 탭: 발견 상품 상세(순위/스토어/상품명/가격/링크) 날짜별 누적
 *
 * 텔레그램 보고: 순위권 내 키워드만 「키워드 (메모): 오늘 ← 전일 ← 전전일 🔼🔽」 로 발송
 *   (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 사용, market.ts 순위 보고와 같은 채널)
 *
 * 순위 기준:
 *   - 쇼핑 검색 API(sort=sim) 노출 순서 = 광고 제외 순수 검색순위
 *   - 키워드당 100개 × 10페이지 = 1,000위까지 탐색
 *   - 가격비교(카탈로그) 묶임 상품은 스토어명 매칭이 안 될 수 있음 → MID 입력으로 해결
 *
 * 실행: cd /home/ubuntu/sales/simple && npx tsx rank.ts
 * 매일 자동 갱신 cron (서버 시간대 = KST):
 *   10 8 * * * cd /home/ubuntu/sales/simple && /usr/bin/npx tsx rank.ts >> /home/ubuntu/sales.log 2>&1
 */

import "dotenv/config";
import { ensureTab, readRange, writeRange, appendRows, loadCredsFromEnv } from "./sheets";

const SHEET_CREDS = loadCredsFromEnv();
const CLIENT_ID = process.env.NAVER_DEVELOPER_CLIENT_ID;
const CLIENT_SECRET = process.env.NAVER_DEVELOPER_CLIENT_SECRET;

const TAB_SRC = "검색량조회";
const TAB_RANK = "순위추적";
const TAB_LOG = "순위추적로그";
const FIXED_HEADERS = ["사업자명", "키워드", "MID", "메모"];
const LOG_HEADERS = ["날짜", "키워드", "순위", "스토어", "상품명", "가격", "링크"];
const MAX_PAGES = Number(process.env.RANK_MAX_PAGES || 10); // 100개 × 10페이지 = 1,000위까지
const MAX_RANKS_IN_CELL = 5;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");

interface ShopItem {
  title: string;
  link: string;
  lprice: string;
  mallName: string;
  productId: string;
  productType: string;
}

interface Hit {
  rank: number;
  store: string;
  title: string;
  price: number;
  link: string;
}

interface RankRow {
  store: string; // 비어있으면 전체 탐색 후 자동 기입
  keyword: string;
  mid: string; // 비어있으면 스토어 단위 탐색
  memo: string;
  history: string[]; // 기존 날짜별 값 (헤더의 날짜 순서와 동일)
}

function loadStoreNames(): string[] {
  const names: string[] = [];
  try {
    const stores = JSON.parse(process.env.NAVER_STORES_JSON || "[]") as { name?: string }[];
    if (Array.isArray(stores)) {
      for (const s of stores) if (s?.name) names.push(String(s.name));
    }
  } catch {
    // NAVER_STORES_JSON 파싱 실패 시 RANK_MALL_NAMES 만으로 진행
  }
  for (const extra of (process.env.RANK_MALL_NAMES || "").split(",")) {
    if (extra.trim()) names.push(extra.trim());
  }
  return names;
}

async function fetchShopPage(query: string, start: number): Promise<{ total: number; items: ShopItem[] }> {
  for (let attempt = 1; ; attempt++) {
    const params = new URLSearchParams({ query, display: "100", start: String(start), sort: "sim" });
    const res = await fetch(`https://openapi.naver.com/v1/search/shop.json?${params}`, {
      headers: { "X-Naver-Client-Id": CLIENT_ID!, "X-Naver-Client-Secret": CLIENT_SECRET! },
    });
    if (res.ok) {
      const data = (await res.json()) as { total?: number; items?: ShopItem[] };
      return { total: data.total ?? 0, items: data.items ?? [] };
    }
    const body = await res.text();
    // 429/5xx 만 재시도, 나머지는 즉시 실패
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) {
      throw new Error(`shop.json ${res.status}: ${body.slice(0, 100)}`);
    }
    await sleep(1000 * attempt);
  }
}

/** 키워드 하나 스캔: 추적 대상 판매처 상품 전부 + 지정 MID 들의 순위를 한 번에 수집 */
async function scanKeyword(
  keyword: string,
  mallMap: Map<string, string>,
  mids: Set<string>,
): Promise<{ storeHits: Hit[]; midInfo: Map<string, { rank: number; mall: string }>; scanned: number }> {
  const storeHits: Hit[] = [];
  const midInfo = new Map<string, { rank: number; mall: string }>();
  let scanned = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * 100 + 1;
    const { total, items } = await fetchShopPage(keyword, start);
    items.forEach((it, idx) => {
      const rank = start + idx;
      const pid = String(it.productId ?? "");
      if (mids.has(pid) && !midInfo.has(pid)) {
        midInfo.set(pid, { rank, mall: it.mallName || "" });
      }
      const store = mallMap.get(norm(it.mallName || ""));
      if (store) {
        storeHits.push({
          rank,
          store,
          title: stripTags(it.title),
          price: Number(it.lprice) || 0,
          link: it.link,
        });
      }
    });
    scanned = start - 1 + items.length;
    if (items.length < 100 || scanned >= total) break;
    await sleep(150);
  }
  return { storeHits, midInfo, scanned };
}

/** 셀 표기: "1위 · 11위 · 13위" (상위 5개, 넘치면 …) */
function ranksCellText(hits: Hit[]): string {
  if (hits.length === 0) return "순위밖";
  const ranks = [...hits].sort((a, b) => a.rank - b.rank).map((h) => `${h.rank}위`);
  const head = ranks.slice(0, MAX_RANKS_IN_CELL).join(" · ");
  return ranks.length > MAX_RANKS_IN_CELL ? `${head} …` : head;
}

/** 셀 문자열에서 최고(첫) 순위 숫자 추출 — "1위 · 11위" → 1, "순위밖"/"오류"/"" → null */
function bestRankOf(cell: string): number | null {
  const m = cell.match(/(\d+)위/);
  return m ? Number(m[1]) : null;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface ReportRow {
  store: string;
  keyword: string;
  mid: string;
  memo: string;
  todayCell: string;
  prevCells: string[]; // [전일, 전전일] 셀 값
}

/** 순위권 내 행만 「키워드/메모/최근 3일 순위」 로 텔레그램 발송 (market.ts 순위 보고와 같은 채널) */
async function sendTelegramReport(today: string, prevDates: string[], reportRows: ReportRow[]): Promise<void> {
  const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TG_TOKEN || !TG_CHAT) {
    console.warn("Telegram 환경변수 없음 — 순위 보고 발송 skip");
    return;
  }

  const lines: string[] = [];
  lines.push(`<b>📈 ${today} 순위 보고 (쇼핑 검색)</b>`);
  if (prevDates.length > 0) {
    lines.push(`<i>오늘 ← 전일${prevDates.length > 1 ? " ← 전전일" : ""} 순 · 1,000위까지 탐색</i>`);
  }
  lines.push("");

  let outOfRank = 0;
  for (const r of reportRows) {
    const todayBest = bestRankOf(r.todayCell);
    const prevBests = prevDates.map((_, i) => bestRankOf(String(r.prevCells[i] ?? "")));
    if (todayBest === null && prevBests.every((b) => b === null)) {
      outOfRank++;
      continue; // 최근 3일 모두 순위밖 → 노이즈 제거
    }
    let arrow = "";
    const prev1 = prevBests[0] ?? null;
    if (todayBest !== null && prev1 !== null) {
      const diff = prev1 - todayBest;
      arrow = diff > 0 ? ` 🔼${diff}` : diff < 0 ? ` 🔽${-diff}` : " →";
    } else if (todayBest !== null && prev1 === null && prevDates.length > 0) {
      arrow = " 🆕 진입";
    } else if (todayBest === null && prev1 !== null) {
      arrow = " ❌ 이탈";
    }
    const note = r.memo || r.store;
    const label = `${escapeHtml(r.keyword)}${note ? ` <i>(${escapeHtml(note)})</i>` : ""}`;
    const rankStr = todayBest !== null ? `<b>${escapeHtml(r.todayCell)}</b>` : "<i>순위밖</i>";
    const trail = prevDates
      .map((_, i) => ` ← ${prevBests[i] !== null ? `${prevBests[i]}위` : "순위밖"}`)
      .join("");
    lines.push(`• ${label}: ${rankStr}${trail}${arrow}`);
  }
  if (outOfRank === reportRows.length) lines.push("오늘 순위권(1,000위) 내 상품 없음");
  if (outOfRank > 0) lines.push("", `<i>그 외 ${outOfRank}개 키워드: 순위밖</i>`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TG_CHAT,
          text: lines.join("\n"),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
      console.log("✅ 순위 보고 텔레그램 발송 완료");
      return;
    } catch (err) {
      console.warn(`[telegram] 재시도 ${attempt}/3: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`);
      if (attempt === 3) console.error("텔레그램 발송 실패 — 시트 기록은 완료됨");
      else await sleep(1500 * attempt);
    }
  }
}

/** 자동 기입용 사업자명: 발견 스토어들을 최고 순위순으로 (예: "비타앤오리진 / 와이케이팜") */
function autoStoreText(hits: Hit[]): string {
  const best = new Map<string, number>();
  for (const h of hits) {
    const prev = best.get(h.store);
    if (prev === undefined || h.rank < prev) best.set(h.store, h.rank);
  }
  return [...best.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([s]) => s)
    .join(" / ");
}

async function main(): Promise<void> {
  if (!SHEET_CREDS) throw new Error("Google Sheet 환경변수 없음");
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("검색 API 키 누락 (NAVER_DEVELOPER_CLIENT_ID/SECRET)");
  }
  const ourStores = loadStoreNames();
  if (ourStores.length === 0) throw new Error("추적할 스토어 없음 (NAVER_STORES_JSON/RANK_MALL_NAMES)");

  // ── 「순위추적」 탭 읽기 ──
  await ensureTab(SHEET_CREDS, TAB_RANK, []);
  const matrix = await readRange(SHEET_CREDS, `${TAB_RANK}!A1:ZZ100000`);
  const header = matrix[0] ?? [];
  const isV3 = header[0] === "사업자명"; // A사업자명 B키워드 C MID D메모 E~날짜
  const isV2 = !isV3 && header[1] === "MID"; // A키워드 B MID C메모 D~날짜 (구버전 → 자동 이관)
  const oldDates: string[] = isV3 ? header.slice(4).map(String) : isV2 ? header.slice(3).map(String) : [];
  const rows: RankRow[] = [];
  const rowKeySet = new Set<string>(); // 사업자명+키워드+MID 조합 중복 방지
  if (isV3 || isV2) {
    for (const r of matrix.slice(1)) {
      const store = isV3 ? String(r[0] ?? "").trim() : "";
      const keyword = String(r[isV3 ? 1 : 0] ?? "").trim();
      if (!keyword) continue;
      const mid = String(r[isV3 ? 2 : 1] ?? "").replace(/\D/g, "");
      const memo = String(r[isV3 ? 3 : 2] ?? "");
      const key = `${norm(store)}|${norm(keyword)}|${mid}`;
      if (rowKeySet.has(key)) continue;
      rowKeySet.add(key);
      const histStart = isV3 ? 4 : 3;
      rows.push({ store, keyword, mid, memo, history: oldDates.map((_, i) => String(r[histStart + i] ?? "")) });
    }
  }

  // ── 검색량조회 탭 키워드 → 없는 키워드는 새 행으로 추가 ──
  const srcRows = await readRange(SHEET_CREDS, `${TAB_SRC}!A4:A10000`);
  const existingKw = new Set(rows.map((r) => norm(r.keyword)));
  for (const r of srcRows) {
    const k = String(r[0] ?? "").trim();
    if (k && !existingKw.has(norm(k))) {
      existingKw.add(norm(k));
      rows.push({ store: "", keyword: k, mid: "", memo: "", history: oldDates.map(() => "") });
    }
  }
  if (rows.length === 0) {
    console.log(`⚠️ 「${TAB_RANK}」 탭 B2 부터 키워드를 입력하고 다시 실행하세요.`);
    return;
  }

  // 추적 대상 판매처 = 우리 스토어 + 사장님이 A열에 직접 적은 판매처명
  const mallMap = new Map(ourStores.map((n) => [norm(n), n]));
  for (const row of rows) {
    if (row.store && !row.store.includes("/") && !mallMap.has(norm(row.store))) {
      mallMap.set(norm(row.store), row.store);
    }
  }

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // KST 기준 날짜
  console.log(`${rows.length}개 행 순위 추적 중… (기본 스토어: ${ourStores.join(", ")})`);

  // ── 키워드별로 묶어서 한 번씩만 스캔 (같은 키워드에 행 여러 개 있어도 API 호출 1세트) ──
  const groups = new Map<string, { keyword: string; mids: Set<string> }>();
  for (const row of rows) {
    const g = groups.get(norm(row.keyword)) ?? { keyword: row.keyword, mids: new Set<string>() };
    if (row.mid) g.mids.add(row.mid);
    groups.set(norm(row.keyword), g);
  }

  const scanResults = new Map<
    string,
    { storeHits: Hit[]; midInfo: Map<string, { rank: number; mall: string }>; error: boolean }
  >();
  const logRows: (string | number)[][] = [];
  let gi = 0;
  for (const [gkey, g] of groups) {
    gi++;
    process.stdout.write(`  [${gi}/${groups.size}] ${g.keyword}: `);
    try {
      const { storeHits, midInfo, scanned } = await scanKeyword(g.keyword, mallMap, g.mids);
      scanResults.set(gkey, { storeHits, midInfo, error: false });
      console.log(storeHits.length > 0 ? ranksCellText(storeHits) : `순위밖 (${scanned}개 탐색)`);
      for (const h of [...storeHits].sort((a, b) => a.rank - b.rank).slice(0, 10)) {
        logRows.push([today, g.keyword, h.rank, h.store, h.title, h.price, h.link]);
      }
    } catch (err) {
      scanResults.set(gkey, { storeHits: [], midInfo: new Map(), error: true });
      console.log(`실패: ${err instanceof Error ? err.message.slice(0, 60) : String(err)}`);
    }
    await sleep(200);
  }

  // ── 오늘 값 계산 후 E열에 삽입 (같은 날 재실행이면 기존 오늘 열 덮어쓰기) ──
  const todayIdx = oldDates.indexOf(today);
  const remainDates = oldDates.filter((d) => d !== today);
  const newHeader = [...FIXED_HEADERS, today, ...remainDates];
  const outMatrix: (string | number)[][] = [newHeader];
  const reportRows: ReportRow[] = [];
  let foundRows = 0;
  for (const row of rows) {
    const res = scanResults.get(norm(row.keyword))!;
    let cell: string;
    let storeOut = row.store;
    if (res.error) {
      cell = "오류";
    } else if (row.mid) {
      const info = res.midInfo.get(row.mid);
      cell = info ? `${info.rank}위` : "순위밖";
      if (!storeOut && info?.mall) storeOut = info.mall;
    } else if (row.store && !row.store.includes("/")) {
      // 지정 판매처 상품만
      const mine = res.storeHits.filter((h) => norm(h.store) === norm(row.store));
      cell = ranksCellText(mine);
    } else {
      cell = ranksCellText(res.storeHits);
      if (!storeOut && res.storeHits.length > 0) storeOut = autoStoreText(res.storeHits);
    }
    if (cell !== "순위밖" && cell !== "오류") foundRows++;
    const history = todayIdx === -1 ? row.history : row.history.filter((_, i) => i !== todayIdx);
    reportRows.push({
      store: storeOut,
      keyword: row.keyword,
      mid: row.mid,
      memo: row.memo,
      todayCell: cell,
      prevCells: [String(history[0] ?? ""), String(history[1] ?? "")],
    });
    const out: (string | number)[] = [storeOut, row.keyword, row.mid, row.memo, cell, ...history];
    while (out.length < newHeader.length) out.push("");
    outMatrix.push(out);
  }
  await writeRange(SHEET_CREDS, `${TAB_RANK}!A1`, outMatrix);

  // ── 텔레그램 보고 (최근 3일: 오늘 + 오늘 열 오른쪽 날짜 2개) ──
  await sendTelegramReport(today, remainDates.slice(0, 2), reportRows);

  // ── 상세 로그 누적 ──
  await ensureTab(SHEET_CREDS, TAB_LOG, LOG_HEADERS);
  await appendRows(SHEET_CREDS, `${TAB_LOG}!A2`, logRows);

  console.log(
    `\n✅ 완료: ${rows.length}개 행 중 ${foundRows}개에서 순위 발견 → 「${TAB_RANK}」 E열(${today}) 갱신 + 로그 ${logRows.length}건.`,
  );
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error("STACK:", err.stack.split("\n").slice(0, 5).join("\n"));
  }
  process.exit(1);
});
