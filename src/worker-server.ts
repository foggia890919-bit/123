import "dotenv/config";
import express from "express";
import { resolveAdapters, ALL_ADAPTERS } from "./scrapers/adapters";
import { loadCredentialsFromEnv, enabledSiteKeys } from "./scrapers/core/env";
import { Session } from "./scrapers/core/session";
import { Scheduler } from "./scrapers/core/scheduler";
import { saveResults } from "./scrapers/core/storage";

const app = express();
app.use(express.json({ limit: "1mb" }));

const TOKEN = process.env.WORKER_TOKEN;
const PORT = Number(process.env.PORT ?? 3001);

function auth(req: express.Request, res: express.Response): boolean {
  if (!TOKEN) return true;
  const header = req.headers.authorization;
  if (header !== `Bearer ${TOKEN}`) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, sites: Object.keys(ALL_ADAPTERS) });
});

app.post("/scrape", async (req, res) => {
  if (!auth(req, res)) return;

  const { codes, sites } = req.body as { codes?: unknown; sites?: unknown };

  if (!Array.isArray(codes) || codes.length === 0) {
    res.status(400).json({ error: "codes (string[]) required" });
    return;
  }
  const validCodes = (codes as unknown[]).filter(
    (c): c is string => typeof c === "string" && /^\d{9,12}$/.test(c)
  );
  if (validCodes.length === 0) {
    res.status(400).json({ error: "no valid insurance codes (9-12 digits)" });
    return;
  }

  // Resolve which sites to scrape
  const enabledKeys = enabledSiteKeys();
  const requestedKeys =
    Array.isArray(sites) && sites.length > 0
      ? (sites as string[]).filter((s) => enabledKeys.includes(s))
      : enabledKeys;

  if (requestedKeys.length === 0) {
    res.status(503).json({ error: "no sites configured — set SCRAPER_SITES env" });
    return;
  }

  let adapters;
  try {
    adapters = resolveAdapters(requestedKeys);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  const credentials = loadCredentialsFromEnv(requestedKeys);
  const session = new Session({ headless: true });

  try {
    await session.start();
    const scheduler = new Scheduler({
      adapters,
      credentials,
      intervalMs: Number(process.env.SCRAPE_INTERVAL_MS ?? 1500),
      session,
    });

    const results = await scheduler.run(validCodes, "cross");

    // Persist to DB if DATABASE_URL is configured
    if (process.env.DATABASE_URL) {
      await saveResults(results).catch((e) =>
        console.error("[worker] DB save failed:", e)
      );
    }

    res.json({ results, source: "live" });
  } catch (err) {
    console.error("[worker] scrape error:", err);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    await session.stop().catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`[worker] listening on :${PORT}`);
  console.log(`[worker] sites: ${enabledSiteKeys().join(", ") || "(none)"}`);
});
