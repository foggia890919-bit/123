import cron from "node-cron";
import { ALL_ADAPTERS } from "../../src/scrapers/adapters/index.ts";
import type { Credentials, WholesaleAdapter } from "../../src/scrapers/core/types.ts";
import {
  hasDb,
  loadExcelMedicationCodes,
  saveSnapshots,
  startJob,
  finishJob,
  pruneOldSnapshots,
  type SnapshotInsert,
} from "./db.ts";

// Per-site call budget: small wait between requests to the same site so we
// don't trigger rate-limiting on the wholesale dashboard.
const PER_SITE_DELAY_MS = Number(process.env.SCHEDULED_DELAY_MS ?? 2000);

interface RunJobDeps {
  scrapeOne: (adapter: WholesaleAdapter, code: string) => Promise<{
    siteKey: string;
    insuranceCode: string;
    items: { insuranceCode?: string; productName: string; spec?: string; manufacturer?: string; unitPrice?: number; stock?: number; raw?: unknown }[];
    error?: string;
  }>;
  getCreds: (siteKey: string) => Credentials | null;
}

export async function runScheduledJob(deps: RunJobDeps): Promise<{ totalCodes: number; sitesRun: string[]; written: number; failed: number }> {
  if (!hasDb()) {
    console.warn("[scheduler] DATABASE_URL not set — skipping scheduled run");
    return { totalCodes: 0, sitesRun: [], written: 0, failed: 0 };
  }

  const codes = await loadExcelMedicationCodes();
  const sitesWithCreds = Object.values(ALL_ADAPTERS).filter(a => deps.getCreds(a.key));

  if (codes.length === 0) {
    console.warn("[scheduler] no Excel medications with insurance codes — skipping");
    return { totalCodes: 0, sitesRun: [], written: 0, failed: 0 };
  }
  if (sitesWithCreds.length === 0) {
    console.warn("[scheduler] no sites have credentials configured — skipping");
    return { totalCodes: 0, sitesRun: [], written: 0, failed: 0 };
  }

  console.log(
    `[scheduler] starting batch: ${codes.length} codes × ${sitesWithCreds.length} sites = ${codes.length * sitesWithCreds.length} fetches`
  );
  const startedAt = Date.now();

  // One ScrapeJob row per site so we can see per-site progress later
  const jobIds = new Map<string, string>();
  for (const site of sitesWithCreds) {
    const id = await startJob({ siteKey: site.key, mode: "scheduled", totalCodes: codes.length });
    jobIds.set(site.key, id);
  }

  const perSiteStats = new Map<string, { done: number; failed: number; error?: string }>();
  for (const site of sitesWithCreds) {
    perSiteStats.set(site.key, { done: 0, failed: 0 });
  }

  // Process each site as its own concurrent loop. Within a site we serialize
  // (one code at a time) so we honour the per-site rate budget; across sites
  // we run in parallel because each site has its own browser context.
  await Promise.all(
    sitesWithCreds.map(async site => {
      const stats = perSiteStats.get(site.key)!;
      try {
        for (const { insuranceCode } of codes) {
          const row = await deps.scrapeOne(site, insuranceCode);
          if (row.error) {
            stats.failed++;
          } else if (row.items.length > 0) {
            const inserts: SnapshotInsert[] = row.items.map(item => ({
              siteKey: site.key,
              insuranceCode,
              item,
            }));
            try {
              await saveSnapshots(inserts);
            } catch (err) {
              console.error(`[scheduler] db write failed for ${site.key}/${insuranceCode}:`, (err as Error).message);
              stats.failed++;
              continue;
            }
            stats.done++;
          } else {
            // No results found — still counts as done (out-of-stock / unlisted)
            stats.done++;
          }
          await new Promise(r => setTimeout(r, PER_SITE_DELAY_MS));
        }
      } catch (err) {
        stats.error = (err as Error).message;
        console.error(`[scheduler] site ${site.key} aborted:`, stats.error);
      }
    })
  );

  // Finalize job rows
  for (const [siteKey, stats] of perSiteStats) {
    const jobId = jobIds.get(siteKey)!;
    await finishJob(jobId, stats).catch(err =>
      console.error(`[scheduler] failed to finalize job ${jobId}:`, err)
    );
  }

  const totalDone = Array.from(perSiteStats.values()).reduce((s, x) => s + x.done, 0);
  const totalFailed = Array.from(perSiteStats.values()).reduce((s, x) => s + x.failed, 0);
  const elapsedMin = Math.round((Date.now() - startedAt) / 60_000);
  console.log(
    `[scheduler] batch finished in ${elapsedMin} min — written: ${totalDone}, failed: ${totalFailed}`
  );

  // Best-effort prune of stale rows
  try {
    const pruned = await pruneOldSnapshots(14);
    if (pruned > 0) console.log(`[scheduler] pruned ${pruned} snapshots older than 14 days`);
  } catch (err) {
    console.warn("[scheduler] prune failed:", (err as Error).message);
  }

  return {
    totalCodes: codes.length,
    sitesRun: sitesWithCreds.map(s => s.key),
    written: totalDone,
    failed: totalFailed,
  };
}

// Three runs per day, KST: 06:00, 12:00, 18:00
// node-cron supports timezone option since v3
let scheduled: cron.ScheduledTask | undefined;
let isRunning = false;

export function startScheduler(deps: RunJobDeps) {
  if (scheduled) return;
  if (process.env.DISABLE_SCHEDULER === "1") {
    console.log("[scheduler] DISABLE_SCHEDULER=1 — not registering cron");
    return;
  }
  const expr = process.env.SCHEDULE_CRON ?? "0 6,12,18 * * *";
  scheduled = cron.schedule(
    expr,
    async () => {
      if (isRunning) {
        console.warn("[scheduler] previous run still in progress — skipping this trigger");
        return;
      }
      isRunning = true;
      try {
        await runScheduledJob(deps);
      } catch (err) {
        console.error("[scheduler] run failed:", err);
      } finally {
        isRunning = false;
      }
    },
    { timezone: "Asia/Seoul" }
  );
  console.log(`[scheduler] registered cron "${expr}" (Asia/Seoul)`);
}

export function isJobRunning() {
  return isRunning;
}

export async function triggerJobNow(deps: RunJobDeps) {
  if (isRunning) throw new Error("a job is already running");
  isRunning = true;
  try {
    return await runScheduledJob(deps);
  } finally {
    isRunning = false;
  }
}
