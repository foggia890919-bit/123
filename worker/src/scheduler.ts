import cron from "node-cron";
import { ALL_ADAPTERS, DISABLED_SITES } from "../../src/scrapers/adapters/index.ts";
import type { Credentials, InventoryItem, WholesaleAdapter } from "../../src/scrapers/core/types.ts";
import {
  hasDb,
  ensureSite,
  loadExcelMedicationCodes,
  loadNonInsuredTargets,
  saveSnapshots,
  startJob,
  finishJob,
  updateJobProgress,
  pruneOldSnapshots,
  type SnapshotInsert,
} from "./db.ts";
import { exportStockToYkOrder } from "./export-ykorder.ts";

// 진행 상황 저장 청크 크기 — 너무 자주 저장하면 DB 쓰기 증가, 너무 드물면 워커 죽었을 때 손실 큼.
const PROGRESS_CHUNK = Math.max(50, Number(process.env.SCHEDULED_PROGRESS_CHUNK ?? 200));

// Wait between consecutive requests within a single scraping lane.
// 사용자 의견: 백제/훼밀리는 rate limiter 없음. 기본값을 짧게 둠.
const PER_SITE_DELAY_MS = Number(process.env.SCHEDULED_DELAY_MS ?? 100);

// Number of parallel browser sessions per site. Each slot logs in
// independently and processes a separate slice of the code list.
// Default 2 = 2× throughput with acceptable memory on a small instance.
const CONCURRENCY_PER_SITE = Math.max(1, Number(process.env.CONCURRENCY_PER_SITE ?? 2));

type ScrapeRowLike = {
  siteKey: string;
  insuranceCode: string;
  items: InventoryItem[];
  error?: string;
};

interface RunJobDeps {
  scrapeOne: (adapter: WholesaleAdapter, code: string, slot?: number) => Promise<ScrapeRowLike>;
  // 비급여 제품명 검색 — 지정되면 코드 배치 뒤에 이름 배치를 실행한다.
  scrapeOneByName?: (adapter: WholesaleAdapter, medicationId: string, productName: string, slot?: number) => Promise<ScrapeRowLike>;
  getCreds: (siteKey: string) => Credentials | null;
}

interface RunOptions {
  limit?: number;        // first N codes only (for smoke testing)
  sites?: string[];      // only these adapter keys
  mode?: string;         // ScrapeJob.mode label, default "scheduled"
  skipNames?: boolean;   // true 면 비급여 이름 배치 생략 (기본 false)
  namesOnly?: boolean;   // true 면 코드 배치 생략, 비급여 이름 배치만 실행 (기본 false)
}

export async function runScheduledJob(
  deps: RunJobDeps,
  opts: RunOptions = {}
): Promise<{ totalCodes: number; sitesRun: string[]; written: number; failed: number }> {
  if (!hasDb()) {
    console.warn("[scheduler] DATABASE_URL not set — skipping scheduled run");
    return { totalCodes: 0, sitesRun: [], written: 0, failed: 0 };
  }

  let codes = opts.namesOnly ? [] : await loadExcelMedicationCodes();
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

  if (sitesWithCreds.length === 0) {
    console.warn("[scheduler] no sites have credentials configured — skipping");
    return { totalCodes: 0, sitesRun: [], written: 0, failed: 0 };
  }

  // namesOnly: 코드 배치 전체를 건너뛰고 비급여 이름 배치만 실행.
  if (opts.namesOnly) {
    console.log("[scheduler] namesOnly — 코드 배치 생략, 비급여 이름 배치만 실행");
    // 이름 배치도 InventorySnapshot.siteKey FK 를 타므로 WholesaleSite 행 보장 필요.
    for (const site of sitesWithCreds) {
      await ensureSite(site).catch(err =>
        console.error(`[scheduler] ensureSite failed for ${site.key}:`, (err as Error).message)
      );
    }
    const { nameWritten, nameFailed } = await runNameBatch(deps, opts, sitesWithCreds);
    return {
      totalCodes: 0,
      sitesRun: sitesWithCreds.map(s => s.key),
      written: nameWritten,
      failed: nameFailed,
    };
  }

  if (codes.length === 0) {
    console.warn("[scheduler] no Excel medications with insurance codes — skipping");
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
            for (const { insuranceCode } of slice) {
              const row = await deps.scrapeOne(site, insuranceCode, slot);
              if (row.error) {
                console.warn(`[scheduler] FAIL ${site.key}/${insuranceCode}: ${row.error}`);
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
                console.info(`[scheduler] EMPTY ${site.key}/${insuranceCode}: 도매상에 등록 없음`);
                stats.done++;
              }
              // PROGRESS_CHUNK 단위로 ScrapeJob.doneCodes 업데이트.
              // 배치 도중 워커가 죽어도 마지막 청크까지의 진행은 보존됨 (헬스체크가 startedAt 기준으로
              // 정상 판정 가능).
              if ((stats.done + stats.failed) % PROGRESS_CHUNK === 0) {
                const jobId = jobIds.get(site.key);
                if (jobId) {
                  updateJobProgress(jobId, { done: stats.done, failed: stats.failed }).catch((err) => {
                    console.warn(`[scheduler] progress update failed: ${(err as Error).message}`);
                  });
                }
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

  // ---------------- 비급여 이름 배치 ----------------
  // 코드 배치가 끝난 뒤, 보험코드 없는 약을 제품명으로 검색해 의사 키 NC:{medicationId} 로 저장.
  const { nameWritten, nameFailed } = await runNameBatch(deps, opts, sitesWithCreds);

  // ---------------- ykpharm-order 재고 내보내기 ----------------
  // 크롤링이 끝난 재고 합계를 ykpharm-order(Supabase) products.stock 으로 push.
  // 실패해도 배치 결과에는 영향 없음 (best-effort).
  try {
    await exportStockToYkOrder();
  } catch (err) {
    console.error("[scheduler] ykorder 재고 내보내기 실패:", (err as Error).message);
  }

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
    written: totalDone + nameWritten,
    failed: totalFailed + nameFailed,
  };
}

// 비급여 이름 배치 — 코드 배치와 동일한 사이트별/lane 분할 구조로 순회.
// 각 결과는 saveSnapshots 에 snapshotKey=`NC:{medicationId}` 로 저장한다.
async function runNameBatch(
  deps: RunJobDeps,
  opts: RunOptions,
  sitesWithCreds: WholesaleAdapter[]
): Promise<{ nameWritten: number; nameFailed: number }> {
  if (opts.skipNames || !deps.scrapeOneByName) {
    return { nameWritten: 0, nameFailed: 0 };
  }
  const scrapeByName = deps.scrapeOneByName;

  // searchByName 을 지원하는 사이트만 대상.
  const nameSites = sitesWithCreds.filter(s => typeof s.searchByName === "function");
  if (nameSites.length === 0) {
    console.log("[scheduler] 비급여 이름배치: searchByName 지원 사이트 없음 — 건너뜀");
    return { nameWritten: 0, nameFailed: 0 };
  }

  let targets = await loadNonInsuredTargets();
  if (opts.limit && opts.limit > 0) targets = targets.slice(0, opts.limit);
  if (targets.length === 0) {
    console.log("[scheduler] 비급여 이름배치: 대상 없음 — 건너뜀");
    return { nameWritten: 0, nameFailed: 0 };
  }

  console.log(`[scheduler] 비급여 이름배치: ${targets.length} 품목 × ${nameSites.length} 사이트`);

  const statsBySite = new Map<string, { done: number; failed: number }>();
  for (const s of nameSites) statsBySite.set(s.key, { done: 0, failed: 0 });

  await Promise.all(
    nameSites.map(async site => {
      const st = statsBySite.get(site.key)!;
      // 코드 배치와 동일하게 interleaving(round-robin) 으로 lane 분할.
      const lanes = Array.from({ length: CONCURRENCY_PER_SITE }, (_, slot) =>
        targets.filter((_, i) => i % CONCURRENCY_PER_SITE === slot)
      );
      await Promise.all(
        lanes.map(async (slice, slot) => {
          for (const t of slice) {
            let row: ScrapeRowLike;
            try {
              row = await scrapeByName(site, t.medicationId, t.productName, slot);
            } catch (err) {
              console.warn(`[scheduler] NAME-FAIL ${site.key}/${t.productName}: ${(err as Error).message}`);
              st.failed++;
              await new Promise(r => setTimeout(r, PER_SITE_DELAY_MS));
              continue;
            }
            if (row.error) {
              console.warn(`[scheduler] NAME-FAIL ${site.key}/${t.productName}: ${row.error}`);
              st.failed++;
            } else if (row.items.length > 0) {
              // 의사 키는 medication 당 1행 → 대표 항목 하나만 저장 (재고 최대치 우선).
              const best = row.items.reduce((a, b) => ((b.stock ?? -1) > (a.stock ?? -1) ? b : a));
              const insert: SnapshotInsert = {
                siteKey: site.key,
                insuranceCode: t.medicationId,
                item: best,
                snapshotKey: `NC:${t.medicationId}`,
              };
              try {
                await saveSnapshots([insert]);
                st.done++;
              } catch (err) {
                console.error(`[scheduler] db write failed for ${site.key}/${t.productName}:`, (err as Error).message);
                st.failed++;
              }
            } else {
              st.done++;
            }
            await new Promise(r => setTimeout(r, PER_SITE_DELAY_MS));
          }
        })
      );
    })
  );

  let nameWritten = 0;
  let nameFailed = 0;
  for (const st of statsBySite.values()) {
    nameWritten += st.done;
    nameFailed += st.failed;
  }
  console.log(`[scheduler] 비급여 이름배치 완료 — done: ${nameWritten}, failed: ${nameFailed}`);
  return { nameWritten, nameFailed };
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

export async function triggerJobNow(deps: RunJobDeps, opts?: RunOptions) {
  if (isRunning) throw new Error("a job is already running");
  isRunning = true;
  try {
    return await runScheduledJob(deps, opts);
  } finally {
    isRunning = false;
  }
}
