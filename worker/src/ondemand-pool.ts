import { ALL_ADAPTERS } from "../../src/scrapers/adapters/index.ts";
import type { Credentials, InventoryItem, WholesaleAdapter } from "../../src/scrapers/core/types.ts";
import { hasDb, ensureSite, saveSnapshots, type SnapshotInsert } from "./db.ts";
import { resolveConfig, type YkConfig } from "./export-ykorder.ts";
import { getSharedExporter } from "./incremental-export.ts";
import { isJobRunning } from "./scheduler.ts";

// 검색 온디맨드 재조회 봇 풀 (요구4).
//   약국/유저가 주문사이트에서 검색하면, 웹앱이 ykorder Supabase 의 큐 테이블
//   public.stock_refresh_requests 에 pending 행을 넣는다. 이 풀이 상시 대기하며
//   1~2초 폴링으로 pending 을 잡아(status=processing) 두 사이트에서 해당 보험코드를
//   즉시 재조회 → InventorySnapshot 갱신 → ykorder 즉시 반영(reflectInsuredCodes) → done.
//
//   레인: 사이트별 로그인 유지 대기 레인. ONDEMAND_LANES(기본 10) 를 사이트 수로 나눠
//     레인/사이트 = floor(ONDEMAND_LANES/2) (기본 5). 프로세서 = 레인/사이트 개수이고,
//     각 프로세서는 사이트마다 전용 슬롯(ONDEMAND_SLOT_BASE+i) 세션을 갖는다(총 10 세션).
//   세션 유지·자동 재로그인: server.ts 의 scrapeOne/getPage(슬롯별 세션, TTL·재로그인 내장)
//     을 그대로 호출하므로 대기 세션 만료 시 자동 재로그인된다.
//   배치 중 축소: 00시 풀배치(isJobRunning) 중에는 활성 프로세서를 1개(=2 레인)로 줄여
//     부하·차단을 낮추고, 배치 종료 후 원복한다.
//   남용 방지: 같은 코드가 60초 내 done 이면 스킵(바로 done). 5분 초과 pending 은 버림(failed).
//   모든 상태 전이(update)는 서비스 키(RLS 우회)로 수행.

const QUEUE = "stock_refresh_requests";
const ONDEMAND_SLOT_BASE = 200; // 배치(0..)/라이브(100+)/리프레시(150+) 와 분리
const POLL_MS = Math.max(1_000, Number(process.env.ONDEMAND_POLL_MS ?? 1_500));
const STALE_MS = Math.max(60_000, Number(process.env.ONDEMAND_STALE_MS ?? 5 * 60_000)); // 오래된 pending 버림
const DEDUP_MS = Math.max(10_000, Number(process.env.ONDEMAND_DEDUP_MS ?? 60_000));      // 최근 done 재조회 스킵
const BATCH_ACTIVE_PROCESSORS = Math.max(1, Number(process.env.ONDEMAND_BATCH_LANES_PER_SITE ?? 1));

type ScrapeRowLike = {
  siteKey: string;
  insuranceCode: string;
  items: InventoryItem[];
  error?: string;
};

interface OndemandDeps {
  scrapeOne: (adapter: WholesaleAdapter, code: string, slot?: number) => Promise<ScrapeRowLike>;
  getCreds: (siteKey: string) => Credentials | null;
}

interface QueueRow {
  id: string;
  insurance_code: string;
  requested_at: string;
}

let started = false;
let lanesPerSite = 5;
let tableMissingWarned = false;
// 최근 done 코드 → 시각(ms). 60초 내 재요청 스킵용.
const recentDone = new Map<string, number>();

function qHeaders(cfg: YkConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// id 로 상태 전이 PATCH. requirePending=true 면 status=eq.pending 조건부(compare-and-swap).
// returnRep=true 면 갱신된 행이 있었는지 여부를 반환(claim 성공 판정).
async function patchStatus(
  cfg: YkConfig,
  id: string,
  body: Record<string, unknown>,
  requirePending: boolean,
  returnRep: boolean
): Promise<boolean> {
  let filter = `?id=eq.${encodeURIComponent(id)}`;
  if (requirePending) filter += `&status=eq.pending`;
  if (returnRep) filter += `&select=id`;
  const res = await fetch(`${cfg.url}/rest/v1/${QUEUE}${filter}`, {
    method: "PATCH",
    headers: qHeaders(cfg, { Prefer: returnRep ? "return=representation" : "return=minimal" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) return false;
  if (returnRep) {
    const arr = (await res.json()) as unknown;
    return Array.isArray(arr) && arr.length > 0;
  }
  return true;
}

async function markDone(cfg: YkConfig, id: string): Promise<void> {
  await patchStatus(cfg, id, { status: "done", processed_at: new Date().toISOString() }, false, false).catch(() => {});
}
async function markFailed(cfg: YkConfig, id: string): Promise<void> {
  await patchStatus(cfg, id, { status: "failed", processed_at: new Date().toISOString() }, false, false).catch(() => {});
}

// 가장 오래된 pending 후보들을 훑어 하나를 원자적으로 claim. 5분 초과 pending 은 버린다(failed).
async function claimOne(cfg: YkConfig): Promise<QueueRow | null> {
  const url =
    `${cfg.url}/rest/v1/${QUEUE}` +
    `?status=eq.pending&order=requested_at.asc&limit=10&select=id,insurance_code,requested_at`;
  let res: Response;
  try {
    res = await fetch(url, { headers: qHeaders(cfg) });
  } catch {
    return null;
  }
  if (!res.ok) {
    if (res.status === 404 && !tableMissingWarned) {
      tableMissingWarned = true;
      console.warn(`[ondemand] 큐 테이블 ${QUEUE} 아직 없음(404) — 생성되면 자동으로 처리 시작`);
    }
    return null;
  }
  const cands = (await res.json()) as QueueRow[];
  if (!Array.isArray(cands) || cands.length === 0) return null;

  for (const c of cands) {
    const ageMs = Date.now() - new Date(c.requested_at).getTime();
    if (ageMs > STALE_MS) {
      // 오래된 pending 버림 — 조건부(아직 pending 일 때만).
      await patchStatus(cfg, c.id, { status: "failed", processed_at: new Date().toISOString() }, true, false).catch(() => {});
      continue;
    }
    const claimed = await patchStatus(cfg, c.id, { status: "processing" }, true, true).catch(() => false);
    if (claimed) return c;
    // 다른 레인이 먼저 가져감 → 다음 후보.
  }
  return null;
}

async function processRequest(
  req: QueueRow,
  laneIdx: number,
  deps: OndemandDeps,
  cfg: YkConfig
): Promise<{ skipped: boolean; saved: number }> {
  const code = (req.insurance_code ?? "").trim();
  if (!code) {
    await markFailed(cfg, req.id);
    return { skipped: true, saved: 0 };
  }

  // 남용 방지: 60초 내 done 이면 바로 done 처리(스킵).
  const last = recentDone.get(code);
  if (last && Date.now() - last < DEDUP_MS) {
    await markDone(cfg, req.id);
    return { skipped: true, saved: 0 };
  }

  const siteKeys = ["ibjp", "family"].filter(k => ALL_ADAPTERS[k] && deps.getCreds(k) !== null);
  const slot = ONDEMAND_SLOT_BASE + laneIdx;
  const rows = await Promise.all(siteKeys.map(k => deps.scrapeOne(ALL_ADAPTERS[k], code, slot)));

  const inserts: SnapshotInsert[] = [];
  for (const row of rows) {
    if (row.error || row.items.length === 0) continue;
    for (const item of row.items) {
      // off-by-one 방어: 결과 행의 코드가 요청 코드와 다르면 버린다(엉뚱한 제품 저장 방지).
      if (item.insuranceCode && item.insuranceCode !== code) continue;
      inserts.push({ siteKey: row.siteKey, insuranceCode: code, item });
    }
  }
  if (inserts.length > 0) await saveSnapshots(inserts);

  // ykorder 즉시 반영 (요구3과 동일 경로).
  try {
    const exporter = await getSharedExporter();
    if (exporter) await exporter.reflectInsuredCodes([code]);
  } catch (e) {
    console.warn(`[ondemand] 반영 실패 code=${code}: ${(e as Error).message}`);
  }

  recentDone.set(code, Date.now());
  if (recentDone.size > 2000) {
    // 오래된 항목 정리.
    const cutoff = Date.now() - DEDUP_MS;
    for (const [k, v] of recentDone) if (v < cutoff) recentDone.delete(k);
  }
  await markDone(cfg, req.id);
  return { skipped: false, saved: inserts.length };
}

async function laneLoop(laneIdx: number, deps: OndemandDeps, cfg: YkConfig): Promise<void> {
  for (;;) {
    try {
      // 배치 중에는 활성 프로세서 축소(레인 2개 = 프로세서 1개).
      const activeProcessors = isJobRunning() ? BATCH_ACTIVE_PROCESSORS : lanesPerSite;
      if (laneIdx >= activeProcessors) {
        await sleep(2_000);
        continue;
      }
      const req = await claimOne(cfg);
      if (!req) {
        await sleep(POLL_MS);
        continue;
      }
      const start = Date.now();
      try {
        const r = await processRequest(req, laneIdx, deps, cfg);
        console.log(
          `[ondemand] lane${laneIdx} code=${req.insurance_code} → done ${Date.now() - start}ms` +
          (r.skipped ? " [skip]" : ` (스냅샷 ${r.saved})`)
        );
      } catch (e) {
        console.warn(`[ondemand] lane${laneIdx} code=${req.insurance_code} 처리 실패: ${(e as Error).message}`);
        await markFailed(cfg, req.id);
      }
    } catch (e) {
      console.warn(`[ondemand] lane${laneIdx} 루프 오류: ${(e as Error).message}`);
      await sleep(2_000);
    }
  }
}

export function startOndemandPool(deps: OndemandDeps): void {
  if (started) return;
  if (!hasDb()) {
    console.log("[ondemand] DATABASE_URL 없음 — 온디맨드 풀 시작 안 함");
    return;
  }
  if (process.env.DISABLE_ONDEMAND === "1") {
    console.log("[ondemand] DISABLE_ONDEMAND=1 — 온디맨드 풀 시작 안 함");
    return;
  }
  const cfg = resolveConfig();
  if (!cfg) {
    console.log("[ondemand] ykorder 설정 없음 — 온디맨드 풀 시작 안 함");
    return;
  }
  const totalLanes = Math.max(2, Number(process.env.ONDEMAND_LANES ?? 10));
  lanesPerSite = Math.max(1, Math.floor(totalLanes / 2));
  started = true;

  // WholesaleSite FK 보장 — 1회.
  for (const k of ["ibjp", "family"]) {
    const a = ALL_ADAPTERS[k];
    if (a) ensureSite(a).catch(err => console.error(`[ondemand] ensureSite ${k} 실패: ${(err as Error).message}`));
  }
  // 공유 반영기 예열(맵 로드) — 첫 요청 지연 최소화.
  void getSharedExporter();

  for (let i = 0; i < lanesPerSite; i++) {
    laneLoop(i, deps, cfg).catch(err => console.error(`[ondemand] lane${i} 종료: ${(err as Error).message}`));
  }
  console.log(
    `[ondemand] 온디맨드 풀 시작 — 사이트당 ${lanesPerSite} 레인(총 ${lanesPerSite * 2} lane, 슬롯 ${ONDEMAND_SLOT_BASE}+), ` +
    `폴링 ${POLL_MS}ms · 배치중 ${BATCH_ACTIVE_PROCESSORS}프로세서로 축소 · dedup ${DEDUP_MS}ms · stale ${STALE_MS}ms`
  );
}
