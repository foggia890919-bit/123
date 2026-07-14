import cron from "node-cron";
import { ALL_ADAPTERS, DISABLED_SITES } from "../../src/scrapers/adapters/index.ts";
import type { Credentials, WholesaleAdapter } from "../../src/scrapers/core/types.ts";
import {
  hasDb,
  ensureSite,
  loadExcelMedicationCodes,
  saveSnapshots,
  startJob,
  finishJob,
  pruneOldSnapshots,
  type SnapshotInsert,
} from "./db.ts";

// Wait between consecutive requests within a single scraping lane.
// 사용자 의견: 백제/훼밀리는 rate limiter 없음. 기본값을 짧게 둠.
const PER_SITE_DELAY_MS = Number(process.env.SCHEDULED_DELAY_MS ?? 100);

// Number of parallel browser sessions per site. Each slot logs in
// independently and processes a separate slice of the code list.
// Default 2 = 2× throughput with acceptable memory on a small instance.
const CONCURRENCY_PER_SITE = Math.max(1, Number(process.env.CONCURRENCY_PER_SITE ?? 2));

interface RunJobDeps {
  scrapeOne: (adapter: WholesaleAdapter, code: string, slot?: number) => Promise<{
    siteKey: string;
    insuranceCode: string;
    items: { insuranceCode?: string; productName: string; spec?: string; manufacturer?: string; unitPrice?: number; stock?: number; raw?: unknown }[];
    error?: string;
  }>;
  getCreds: (siteKey: string) => Credentials | null;
}

interface RunOptions {
  limit?: number;        // first N codes only (for smoke testing)
  sites?: string[];      // only these adapter keys
  mode?: string;         // ScrapeJob.mode label, default "scheduled"
}

export async function runScheduledJob(
  deps: RunJobDeps,
  opts: RunOptions = {}
): Promise<{ totalCodes: number; sitesRun: string[]; written: number; failed: number }> {
  if (!hasDb()) {
    console.warn("[scheduler] DATABASE_URL not set — skipping scheduled run");
    return { totalCodes: 0, sitesRun: [], written: 0, failed: 0 };
  }

  let codes = await loadExcelMedicationCodes();
  if (opts.limit && opts.limit > 0) {
    codes = codes.slice(0, opts.limit);
  }

  let sitesWithCreds = Object.values(ALL_ADAPTERS).filter(a => {
    if (DISABLED_SITES.has(a.key)) {
      console.warn(`[crawler] ${a.key} disabled — login popup issue`);
      return false;
    }
    return deps.getCreds(a.key) !== null;
  });
  if (opts.sites && opts.sites.length > 0) {
    const want = new Set(opts.sites);
    sitesWithCreds = sitesWithCreds.filter(a => want.has(a.key));
  }

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

  // Ensure WholesaleSite rows exist before creating ScrapeJob rows (FK guard).
  for (const site of sitesWithCreds) {
    await ensureSite(site).catch(err =>
      console.error(`[scheduler] ensureSite failed for ${site.key}:`, (err as Error).message)
    );
  }

  const jobMode = opts.mode ?? "scheduled";
  // One ScrapeJob row per site so we can see per-site progress later
  const jobIds = new Map<string, string>();
  for (const site of sitesWithCreds) {
    const id = await startJob({ siteKey: site.key, mode: jobMode, totalCodes: codes.length });
    jobIds.set(site.key, id);
  }

  const perSiteStats = new Map<string, { done: number; failed: number; error?: string }>();
  for (const site of sitesWithCreds) {
    perSiteStats.set(site.key, { done: 0, failed: 0 });
  }

  // Sites run in parallel (Promise.all over sites).
  // Within each site, CONCURRENCY_PER_SITE lanes run concurrently — each lane
  // owns a separate logged-in browser session and processes its own slice of codes.
  await Promise.all(
    sitesWithCreds.map(async site => {
      const stats = perSiteStats.get(site.key)!;
      try {
        // Split codes across lanes by interleaving (round-robin) so each lane
        // gets an even mix of codes rather than a contiguous block.
        const lanes = Array.from({ length: CONCURRENCY_PER_SITE }, (_, slot) =>
          codes.filter((_, i) => i % CONCURRENCY_PER_SITE === slot)
        );

        await Promise.all(
          lanes.map(async (slice, slot) => {
            for (const { insuranceCode, productName } of slice) {
              const row = await deps.scrapeOne(site, insuranceCode, slot);
              if (row.error) {
                // 조회 실패(네트워크/타임아웃/먹통) → 저장하지 않음. 옛 값을 유지(0으로 덮지 않음).
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
                // 검색은 정상 실행됐으나 결과 0건 = 도매상 미취급/품절 → stock 0 으로 갱신.
                // (조회 실패는 위 row.error 로 걸러지므로, 멀쩡한 재고가 0으로 덮이지 않는다)
                // 이로써 "체크한 모든 품목"이 최신 시점으로 갱신돼, 일부만 옛 값으로 굳는 문제가 사라짐.
                try {
                  await saveSnapshots([{
                    siteKey: site.key,
                    insuranceCode,
                    item: { insuranceCode, productName, stock: 0, spec: null, manufacturer: null, unitPrice: null },
                  }]);
                } catch (err) {
                  console.error(`[scheduler] db write(empty) failed for ${site.key}/${insuranceCode}:`, (err as Error).message);
                }
                stats.done++;
              }
              await new Promise(r => setTimeout(r, PER_SITE_DELAY_MS));
            }
          })
        );
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

// 작업 전체의 상한 시간. 어떤 이유로든(스크랩/DB 멈춤) runScheduledJob 이 안 끝나면
// 이 시간 뒤 강제로 reject → finally 에서 isRunning 이 풀려, 다음 스케줄이 영구 스킵되지 않음.
// 정상 배치보다 충분히 길게(기본 90분) 잡아 정상 작업을 오인 중단하지 않는다.
const MAX_JOB_MS = Number(process.env.MAX_JOB_MS ?? 90 * 60 * 1000);

function withJobTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`job exceeded ${Math.round(ms / 60000)}min — forcing reset`)), ms)
    ),
  ]);
}

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
        await withJobTimeout(runScheduledJob(deps), MAX_JOB_MS);
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

export async function triggerJobNow(deps: RunJobDeps, opts?: RunOptions) {
  if (isRunning) throw new Error("a job is already running");
  isRunning = true;
  try {
    return await withJobTimeout(runScheduledJob(deps, opts), MAX_JOB_MS);
  } finally {
    isRunning = false;
  }
}
