import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_ADAPTERS } from "../../src/scrapers/adapters/index.ts";
import type { Credentials, InventoryItem, WholesaleAdapter } from "../../src/scrapers/core/types.ts";
import { startScheduler, triggerJobNow, isJobRunning } from "./scheduler.ts";
import { hasDb } from "./db.ts";
import { startEpharmsScheduler } from "./epharms/cron.ts";
import { isEpharmsSyncRunning, runEpharmsSync, forceResetSync } from "./epharms/sync.ts";
import { isProductSyncRunning, syncProductMaster } from "./epharms/products.ts";

// 시작 시 .env 중복 키 검증 — dotenv는 첫 값을 적용하므로 같은 키가 여러 번 적혀있으면 의도와 다른 값이 적용될 수 있음.
function checkEnvDuplicates() {
  try {
    const envPath = resolve(process.cwd(), ".env");
    const content = readFileSync(envPath, "utf-8");
    const seen = new Map<string, number>();
    const dups: string[] = [];
    let lineNo = 0;
    for (const raw of content.split("\n")) {
      lineNo++;
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (seen.has(key)) {
        dups.push(`${key} (line ${seen.get(key)} & ${lineNo})`);
      } else {
        seen.set(key, lineNo);
      }
    }
    if (dups.length > 0) {
      console.error(`[startup] ⚠️ .env에 중복 키 ${dups.length}건 발견 — dotenv는 첫 값을 적용합니다:`);
      for (const d of dups) console.error(`  - ${d}`);
    } else {
      console.log("[startup] .env 검증 OK (중복 키 없음)");
    }
  } catch (err) {
    console.warn(`[startup] .env 검증 건너뜀: ${(err as Error).message}`);
  }
}
checkEnvDuplicates();

const PORT = Number(process.env.PORT ?? 8080);
const TOKEN = process.env.WORKER_TOKEN ?? "";
const INTERVAL_MS = Number(process.env.SCRAPE_INTERVAL_MS ?? 1500);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 20 * 60 * 1000);

// 시작 시 실제 적용된 핵심 환경변수 로그 — 트러블슈팅용
console.log(`[startup] PORT=${PORT} INTERVAL_MS=${INTERVAL_MS} ` +
  `CONCURRENCY_PER_SITE=${process.env.CONCURRENCY_PER_SITE ?? "(default)"} ` +
  `SCHEDULE_CRON="${process.env.SCHEDULE_CRON ?? "(default 0 6,12,18 * * *)"}" ` +
  `LIVE_CONCURRENCY=${process.env.LIVE_CONCURRENCY ?? "(default)"}`);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

if (!TOKEN) {
  console.error("[fatal] WORKER_TOKEN is required (refusing to start with empty token)");
  process.exit(1);
}

// -------------------- Browser session manager ----------------------
// Sessions keyed by `${siteKey}:${slot}` to support per-site concurrency.
// CONCURRENCY_PER_SITE=N creates N independent browser contexts per site,
// each logged in separately, processing different subsets of codes in parallel.
const CONCURRENCY_PER_SITE = Math.max(1, Number(process.env.CONCURRENCY_PER_SITE ?? 1));

let browser: Browser | undefined;
const sessions = new Map<string, { ctx: BrowserContext; page: Page; lastLogin: number }>();
const lastCallAt = new Map<string, number>();

async function ensureBrowser() {
  if (browser) return browser;
  browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  return browser;
}

async function getPage(adapter: WholesaleAdapter, creds: Credentials, slot = 0): Promise<Page> {
  await ensureBrowser();
  const key = `${adapter.key}:${slot}`;
  const existing = sessions.get(key);
  if (existing) {
    const stale = Date.now() - existing.lastLogin > SESSION_TTL_MS;
    if (!stale) {
      try {
        if (await adapter.isLoggedIn(existing.page)) return existing.page;
      } catch {
        // fall through to relogin
      }
    }
    await existing.ctx.close().catch(() => {});
    sessions.delete(key);
  }
  const ctx = await browser!.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: UA,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  const page = await ctx.newPage();
  await adapter.login(page, creds);
  sessions.set(key, { ctx, page, lastLogin: Date.now() });
  return page;
}

async function invalidate(key: string) {
  const ex = sessions.get(key);
  if (!ex) return;
  await ex.ctx.close().catch(() => {});
  sessions.delete(key);
}

function getCreds(siteKey: string): Credentials | null {
  const pre = `SCRAPER_${siteKey.toUpperCase()}_`;
  const id = process.env[`${pre}ID`];
  const pw = process.env[`${pre}PW`];
  return id && pw ? { id, pw } : null;
}

async function rateLimit(siteKey: string, slot = 0) {
  const key = `${siteKey}:${slot}`;
  const last = lastCallAt.get(key) ?? 0;
  const wait = INTERVAL_MS - (Date.now() - last);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCallAt.set(key, Date.now());
}

interface ScrapeRow {
  siteKey: string;
  insuranceCode: string;
  items: InventoryItem[];
  error?: string;
  durationMs: number;
  scrapedAt: string;  // 응답이 만들어진 시각 — 화면이 "방금" 으로 갱신할 수 있게.
}

async function scrapeOne(adapter: WholesaleAdapter, code: string, slot = 0): Promise<ScrapeRow> {
  const start = Date.now();
  const creds = getCreds(adapter.key);
  if (!creds) {
    return {
      siteKey: adapter.key,
      insuranceCode: code,
      items: [],
      error: "no credentials configured for this site",
      durationMs: 0,
      scrapedAt: new Date().toISOString(),
    };
  }
  await rateLimit(adapter.key, slot);
  const sessionKey = `${adapter.key}:${slot}`;
  try {
    const page = await getPage(adapter, creds, slot);
    let items = await adapter.searchByCode(page, code);
    // 보강: 결과 0건이면 한 번 더 시도. 사이트 일시 응답 변동 / 페이지 미로딩 케이스 보강.
    // 진짜 품절(결과 있으나 stock=0)은 items.length>0 이라 재시도 대상 아님.
    if (items.length === 0) {
      await new Promise(r => setTimeout(r, 600));
      const retry = await adapter.searchByCode(page, code).catch(() => [] as InventoryItem[]);
      if (retry.length > 0) items = retry;
    }
    return { siteKey: adapter.key, insuranceCode: code, items, durationMs: Date.now() - start, scrapedAt: new Date().toISOString() };
  } catch (err) {
    await invalidate(sessionKey);
    return {
      siteKey: adapter.key,
      insuranceCode: code,
      items: [],
      error: (err as Error).message,
      durationMs: Date.now() - start,
      scrapedAt: new Date().toISOString(),
    };
  }
}

// -------------------- HTTP server -----------------------------------
const app = express();
app.use(express.json({ limit: "1mb" }));

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/health") return next();
  const auth = req.header("authorization");
  if (auth !== `Bearer ${TOKEN}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    adapters: Object.keys(ALL_ADAPTERS),
    activeSessions: Array.from(sessions.keys()),
    db: hasDb(),
    jobRunning: isJobRunning(),
    epharmsSyncRunning: isEpharmsSyncRunning(),
  });
});

// ePharms 매출원장 sync 수동 트리거.
//   POST /epharms/sync                  → 모든 활성 계정 sync
//   POST /epharms/sync?accountId=XXX    → 단일 계정만 sync (테스트용)
app.post("/epharms/sync", async (req, res) => {
  if (!hasDb()) {
    res.status(503).json({ error: "DATABASE_URL not configured" });
    return;
  }
  if (isEpharmsSyncRunning()) {
    res.status(409).json({ error: "ePharms sync already running" });
    return;
  }
  const onlyAccountId =
    typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  // fire-and-forget — 한 거래처당 수십초 걸릴 수 있음
  runEpharmsSync({ onlyAccountId }).catch(err =>
    console.error("[epharms] manual sync failed:", err)
  );
  res.json({ ok: true, started: true, onlyAccountId: onlyAccountId ?? null });
});

// 강제 재시작: hung 상태의 running 플래그를 초기화 후 즉시 전체 sync 재시작.
app.post("/epharms/sync/reset", async (req, res) => {
  if (!hasDb()) { res.status(503).json({ error: "DATABASE_URL not configured" }); return; }
  forceResetSync();
  runEpharmsSync({}).catch(err => console.error("[epharms] force-restart failed:", err));
  res.json({ ok: true, reset: true, started: true });
});

// 이팜스 상품 마스터 자동 동기화 — 페이지별 크롤링.
// body: { triggeredBy?: string }
// 워커가 직접 DB에 upsert하므로 별도 업로드 URL 불필요.
// fire-and-forget: 전체 카탈로그 순회는 10~30분 걸림.
app.post("/epharms/sync-products", async (req, res) => {
  if (isProductSyncRunning()) {
    res.status(409).json({ error: "product sync already running" });
    return;
  }
  const { triggeredBy } = (req.body ?? {}) as { triggeredBy?: string };
  syncProductMaster({ triggeredBy }).catch(err =>
    console.error("[products] sync failed:", err)
  );
  res.json({ ok: true, started: true });
});

// Manually trigger a scheduled batch run. Useful for testing and for the
// admin "지금 새로 긁기" button. Authenticated via the same Bearer token.
//
// Query params:
//   ?limit=N         only scrape the first N codes (smoke test)
//   ?sites=ibjp,family   only these adapter keys
//   ?mode=label      override ScrapeJob.mode (default "manual")
app.post("/scrape-batch", async (req, res) => {
  if (!hasDb()) {
    res.status(503).json({ error: "DATABASE_URL not configured on worker" });
    return;
  }
  if (isJobRunning()) {
    res.status(409).json({ error: "a job is already running" });
    return;
  }
  const limitRaw = req.query.limit;
  const sitesRaw = req.query.sites;
  const modeRaw = req.query.mode;
  const limit = typeof limitRaw === "string" ? Number(limitRaw) : undefined;
  const sites = typeof sitesRaw === "string"
    ? sitesRaw.split(",").map(s => s.trim()).filter(Boolean)
    : undefined;
  const mode = typeof modeRaw === "string" ? modeRaw : "manual";

  // Fire-and-forget so the HTTP request doesn't time out for hours-long runs
  triggerJobNow({ scrapeOne, getCreds }, { limit, sites, mode }).catch(err =>
    console.error("[server] manual batch failed:", err)
  );
  res.json({ ok: true, started: true, limit, sites, mode });
});

app.get("/sites", (_req, res) => {
  res.json({
    sites: Object.values(ALL_ADAPTERS).map(a => ({
      key: a.key,
      name: a.name,
      hasCredentials: !!getCreds(a.key),
      activeSession: sessions.has(a.key),
    })),
  });
});

// 라이브 호출 전용 lane — 풀배치(scheduler) 가 slot 0..CONCURRENCY_PER_SITE-1 을
// 점유하는 동안에도 사용자 검색은 별도 브라우저 세션으로 즉시 처리.
// 슬롯 번호를 충분히 큰 값(+100)으로 띄워 풀배치와 절대 안 겹치게 한다.
const LIVE_SLOT_BASE = 100;
const LIVE_CONCURRENCY = Math.max(1, Number(process.env.LIVE_CONCURRENCY ?? 2));

app.post("/scrape", async (req, res) => {
  const { sites, codes } = req.body as { sites?: string[]; codes: string[] };
  if (!Array.isArray(codes) || codes.length === 0) {
    res.status(400).json({ error: "codes (string[]) required" });
    return;
  }
  const targetKeys =
    sites && sites.length
      ? sites.filter(k => ALL_ADAPTERS[k])
      : Object.keys(ALL_ADAPTERS).filter(k => getCreds(k));
  if (targetKeys.length === 0) {
    res.status(400).json({ error: "no resolvable sites with credentials" });
    return;
  }

  // 사이트는 코드별로 병렬 — 사이트당 LIVE_CONCURRENCY lane 까지 동시 처리.
  // 풀배치와 별도 슬롯이라 lane 경쟁 없음.
  const results: ScrapeRow[] = [];
  for (let i = 0; i < codes.length; i += LIVE_CONCURRENCY) {
    const codeChunk = codes.slice(i, i + LIVE_CONCURRENCY);
    const rows = await Promise.all(
      codeChunk.flatMap((code, j) =>
        targetKeys.map(key => scrapeOne(ALL_ADAPTERS[key], code, LIVE_SLOT_BASE + j))
      )
    );
    results.push(...rows);
  }
  res.json({ results });
});

app.post("/scrape-one", async (req, res) => {
  const { site, code } = req.body as { site: string; code: string };
  const adapter = ALL_ADAPTERS[site];
  if (!adapter) {
    res.status(400).json({ error: `unknown site: ${site}` });
    return;
  }
  if (!code) {
    res.status(400).json({ error: "code required" });
    return;
  }
  const row = await scrapeOne(adapter, code, LIVE_SLOT_BASE);
  res.json(row);
});

const server = app.listen(PORT, () => {
  console.log(`[worker] listening on :${PORT}`);
  console.log(`[worker] adapters: ${Object.keys(ALL_ADAPTERS).join(", ")}`);
  console.log(`[worker] db: ${hasDb() ? "configured" : "NOT configured (scheduler will skip)"}`);
  startScheduler({ scrapeOne, getCreds });
  startEpharmsScheduler();
});

async function shutdown() {
  console.log("[worker] shutting down...");
  for (const s of sessions.values()) await s.ctx.close().catch(() => {});
  await browser?.close().catch(() => {});
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
