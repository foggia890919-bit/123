import "dotenv/config";
import { resolveAdapters } from "./adapters";
import { enabledSiteKeys, loadCredentialsFromEnv } from "./core/env";
import { Scheduler } from "./core/scheduler";
import { Session } from "./core/session";
import { ensureSite, finishJob, saveResults, saveResultsToCsv, saveResultsToXlsx, startJob } from "./core/storage";
import type { DistributionMode, ScrapeResult } from "./core/types";
import { loadCodesFromDB, loadFrequentCodes, loadPocCodes } from "./codes/loader";

type Mode = "poc" | "frequent" | "full";

interface CliArgs {
  mode: Mode;
  distribution: DistributionMode;
  intervalMs: number;
  limit?: number;
}

function parseArgs(): CliArgs {
  const mode = (process.argv[2] ?? "poc") as Mode;
  if (!["poc", "frequent", "full"].includes(mode)) {
    throw new Error(`Invalid mode: ${mode}. Use poc | frequent | full`);
  }
  const distribution = (process.env.SCRAPE_DISTRIBUTION ?? "round-robin") as DistributionMode;
  const intervalMs = Number(process.env.SCRAPE_INTERVAL_MS ?? 2000);
  const limit = process.env.SCRAPE_LIMIT ? Number(process.env.SCRAPE_LIMIT) : undefined;
  return { mode, distribution, intervalMs, limit };
}

async function loadCodes(mode: Mode): Promise<string[]> {
  if (mode === "poc") return loadPocCodes();
  if (mode === "frequent") return loadFrequentCodes(5000);
  return loadCodesFromDB();
}

async function main() {
  const args = parseArgs();
  const keys = enabledSiteKeys();
  if (keys.length === 0) {
    throw new Error("SCRAPER_SITES env is empty. Set e.g. SCRAPER_SITES=ibjp");
  }
  const adapters = resolveAdapters(keys);
  const credentials = loadCredentialsFromEnv(keys);
  const missing = keys.filter(k => !credentials[k]);
  if (missing.length) {
    console.warn(`[warn] missing credentials for: ${missing.join(", ")} — these sites will be skipped`);
  }

  const allCodes = await loadCodes(args.mode);
  const codes = args.limit ? allCodes.slice(0, args.limit) : allCodes;
  console.log(`[info] mode=${args.mode} sites=${keys.join(",")} codes=${codes.length} interval=${args.intervalMs}ms distribution=${args.distribution}`);

  const useDb = !!process.env.DATABASE_URL;
  console.log(`[info] DB save: ${useDb ? "ON" : "OFF"} (CSV save is always on)`);

  const jobIds: Record<string, string> = {};
  if (useDb) {
    for (const a of adapters) await ensureSite(a);
    for (const a of adapters.filter(a => credentials[a.key])) {
      jobIds[a.key] = await startJob(a.key, args.mode, codes.length);
    }
  }

  const perSite: Record<string, { done: number; failed: number }> = {};
  const session = new Session({ headless: true });
  await session.start();

  const results: ScrapeResult[] = [];
  try {
    const scheduler = new Scheduler({
      adapters,
      credentials,
      intervalMs: args.intervalMs,
      session,
      onResult: r => {
        perSite[r.siteKey] ??= { done: 0, failed: 0 };
        if (r.error) perSite[r.siteKey].failed += 1;
        else perSite[r.siteKey].done += 1;
        const stats = perSite[r.siteKey];
        const total = stats.done + stats.failed;
        // Per-code progress for small runs (<100); summary every 25 for large.
        const verbose = codes.length < 100;
        if (verbose || total % 25 === 0) {
          const status = r.error ? `ERR ${r.error}` : `${r.items.length} item(s)`;
          console.log(`[${r.siteKey} ${total}/${codes.length}] ${r.insuranceCode} → ${status}`);
        }
      },
    });
    const out = await scheduler.run(codes, args.distribution);
    results.push(...out);

    const xlsxPath = await saveResultsToXlsx(results);
    console.log(`[xlsx] saved -> ${xlsxPath}`);
    const csvPath = await saveResultsToCsv(results);
    console.log(`[csv]  saved -> ${csvPath}`);

    if (useDb) {
      const saved = await saveResults(results);
      console.log(`[db]  saved ${saved} rows`);
    }
    console.log(`[done] scraped=${results.length} errors=${results.filter(r => r.error).length}`);
  } finally {
    if (useDb) {
      for (const [key, stats] of Object.entries(perSite)) {
        if (jobIds[key]) await finishJob(jobIds[key], stats).catch(() => {});
      }
    }
    await session.stop();
  }
}

main().catch(err => {
  console.error("[fatal]", err);
  process.exit(1);
});
