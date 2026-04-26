import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { ALL_ADAPTERS } from "../../src/scrapers/adapters/index.ts";
import type { Credentials, InventoryItem, WholesaleAdapter } from "../../src/scrapers/core/types.ts";
import { startScheduler, triggerJobNow, isJobRunning } from "./scheduler.ts";
import { hasDb } from "./db.ts";

const PORT = Number(process.env.PORT ?? 8080);
const TOKEN = process.env.WORKER_TOKEN ?? "";
const INTERVAL_MS = Number(process.env.SCRAPE_INTERVAL_MS ?? 1500);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 20 * 60 * 1000);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

if (!TOKEN) {
  console.error("[fatal] WORKER_TOKEN is required (refusing to start with empty token)");
  process.exit(1);
}

// -------------------- Browser session manager ----------------------
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

async function getPage(adapter: WholesaleAdapter, creds: Credentials): Promise<Page> {
  await ensureBrowser();
  const existing = sessions.get(adapter.key);
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
    sessions.delete(adapter.key);
  }
  const ctx = await browser!.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: UA,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  const page = await ctx.newPage();
  await adapter.login(page, creds);
  sessions.set(adapter.key, { ctx, page, lastLogin: Date.now() });
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

async function rateLimit(siteKey: string) {
  const last = lastCallAt.get(siteKey) ?? 0;
  const wait = INTERVAL_MS - (Date.now() - last);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCallAt.set(siteKey, Date.now());
}

interface ScrapeRow {
  siteKey: string;
  insuranceCode: string;
  items: InventoryItem[];
  error?: string;
  durationMs: number;
}

async function scrapeOne(adapter: WholesaleAdapter, code: string): Promise<ScrapeRow> {
  const start = Date.now();
  const creds = getCreds(adapter.key);
  if (!creds) {
    return {
      siteKey: adapter.key,
      insuranceCode: code,
      items: [],
      error: "no credentials configured for this site",
      durationMs: 0,
    };
  }
  await rateLimit(adapter.key);
  try {
    const page = await getPage(adapter, creds);
    const items = await adapter.searchByCode(page, code);
    return { siteKey: adapter.key, insuranceCode: code, items, durationMs: Date.now() - start };
  } catch (err) {
    await invalidate(adapter.key);
    return {
      siteKey: adapter.key,
      insuranceCode: code,
      items: [],
      error: (err as Error).message,
      durationMs: Date.now() - start,
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
  });
});

// Manually trigger a scheduled batch run. Useful for testing and for the
// admin "지금 새로 긁기" button. Authenticated via the same Bearer token.
app.post("/scrape-batch", async (_req, res) => {
  if (!hasDb()) {
    res.status(503).json({ error: "DATABASE_URL not configured on worker" });
    return;
  }
  if (isJobRunning()) {
    res.status(409).json({ error: "a job is already running" });
    return;
  }
  // Fire-and-forget so the HTTP request doesn't time out for hours-long runs
  triggerJobNow({ scrapeOne, getCreds }).catch(err =>
    console.error("[server] manual batch failed:", err)
  );
  res.json({ ok: true, started: true });
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

  // Sites are scraped in parallel for each code; codes are still sequential
  // so we don't open dozens of contexts on the same site at once.
  const results: ScrapeRow[] = [];
  for (const code of codes) {
    const rows = await Promise.all(
      targetKeys.map(key => scrapeOne(ALL_ADAPTERS[key], code))
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
  const row = await scrapeOne(adapter, code);
  res.json(row);
});

const server = app.listen(PORT, () => {
  console.log(`[worker] listening on :${PORT}`);
  console.log(`[worker] adapters: ${Object.keys(ALL_ADAPTERS).join(", ")}`);
  console.log(`[worker] db: ${hasDb() ? "configured" : "NOT configured (scheduler will skip)"}`);
  startScheduler({ scrapeOne, getCreds });
});

async function shutdown() {
  console.log("[worker] shutting down...");
  for (const s of sessions.values()) await s.ctx.close().catch(() => {});
  await browser?.close().catch(() => {});
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
