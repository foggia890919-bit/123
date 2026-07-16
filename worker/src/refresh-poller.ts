import { ALL_ADAPTERS } from "../../src/scrapers/adapters/index.ts";
import type { Credentials, InventoryItem, WholesaleAdapter } from "../../src/scrapers/core/types.ts";
import { hasDb, getPool, ensureSite, saveSnapshots, type SnapshotInsert } from "./db.ts";

// 실시간 재고 조회 대기줄 폴러.
// KMD API(Vercel)가 RefreshRequest(PENDING) 를 만들면, 이 폴러가 오래된 순으로
// 1건씩 집어(RUNNING 마킹) 크롤 → InventorySnapshot 저장 → DONE/ERROR 로 갱신한다.
// Vercel→PC 인바운드가 불가능하므로 DB(Supabase)를 매개로 하는 pull 방식.

// 라이브 슬롯 대역 — server.ts 의 풀배치(0..CONCURRENCY-1)/라이브 /scrape(LIVE_SLOT_BASE=100)
// 와 절대 겹치지 않도록 충분히 띄운 별도 대역(150+)을 쓴다. lane 경쟁 없음.
const REFRESH_SLOT_BASE = 150;
const REFRESH_CONCURRENCY = Math.max(1, Number(process.env.REFRESH_CONCURRENCY ?? 2));
const POLL_MS = Math.max(3_000, Number(process.env.REFRESH_POLL_MS ?? 15_000));

type ScrapeRowLike = {
  siteKey: string;
  insuranceCode: string;
  items: InventoryItem[];
  error?: string;
};

interface RefreshPollerDeps {
  scrapeOne: (adapter: WholesaleAdapter, code: string, slot?: number) => Promise<ScrapeRowLike>;
  getCreds: (siteKey: string) => Credentials | null;
}

interface ClaimedRequest {
  id: string;
  codes: string[];
  sites: string[] | null;
}

// 한 번에 1건만 처리 (겹침 방지). setInterval tick 이 처리 중이면 즉시 리턴.
let processing = false;
let timer: ReturnType<typeof setInterval> | undefined;

// PENDING 중 가장 오래된 1건을 원자적으로 RUNNING 으로 집는다.
// UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING 패턴으로
// 여러 워커/틱이 같은 row 를 동시에 집는 경쟁을 방지.
async function claimOldestPending(): Promise<ClaimedRequest | null> {
  const { rows } = await getPool().query<ClaimedRequest>(
    `UPDATE "RefreshRequest"
        SET "status" = 'RUNNING'
      WHERE "id" = (
        SELECT "id" FROM "RefreshRequest"
         WHERE "status" = 'PENDING'
         ORDER BY "createdAt" ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "codes", "sites"`
  );
  return rows[0] ?? null;
}

async function markDone(id: string): Promise<void> {
  await getPool().query(
    `UPDATE "RefreshRequest" SET "status" = 'DONE', "doneAt" = NOW() WHERE "id" = $1`,
    [id]
  );
}

async function markError(id: string, message: string): Promise<void> {
  await getPool().query(
    `UPDATE "RefreshRequest" SET "status" = 'ERROR', "error" = $2, "doneAt" = NOW() WHERE "id" = $1`,
    [id, message.slice(0, 1000)]
  );
}

async function processRequest(reqRow: ClaimedRequest, deps: RefreshPollerDeps): Promise<void> {
  const start = Date.now();
  const codes = Array.isArray(reqRow.codes) ? reqRow.codes : [];
  const sitesReq = Array.isArray(reqRow.sites) ? reqRow.sites : [];

  // 대상 사이트: 지정되면 그 키들(등록된 어댑터만), 아니면 크리덴셜 있는 전체.
  const targetKeys =
    sitesReq.length > 0
      ? sitesReq.filter(k => ALL_ADAPTERS[k])
      : Object.keys(ALL_ADAPTERS).filter(k => deps.getCreds(k) !== null);

  if (targetKeys.length === 0) {
    await markError(reqRow.id, "no resolvable sites with credentials");
    return;
  }
  if (codes.length === 0) {
    await markError(reqRow.id, "no codes in request");
    return;
  }

  // InventorySnapshot.siteKey FK 보장.
  for (const key of targetKeys) {
    await ensureSite(ALL_ADAPTERS[key]).catch(err =>
      console.error(`[refresh] ensureSite 실패 ${key}:`, (err as Error).message)
    );
  }

  // codes 를 REFRESH_CONCURRENCY lane 으로 나눠 사이트별 병렬 크롤 (server.ts /scrape 로직 참고).
  // 슬롯은 REFRESH_SLOT_BASE + laneIndex 로 라이브/풀배치와 분리.
  const inserts: SnapshotInsert[] = [];
  for (let i = 0; i < codes.length; i += REFRESH_CONCURRENCY) {
    const chunk = codes.slice(i, i + REFRESH_CONCURRENCY);
    const rows = await Promise.all(
      chunk.flatMap((code, j) =>
        targetKeys.map(key => deps.scrapeOne(ALL_ADAPTERS[key], code, REFRESH_SLOT_BASE + j))
      )
    );
    for (const row of rows) {
      if (row.error || row.items.length === 0) continue;
      for (const item of row.items) {
        inserts.push({ siteKey: row.siteKey, insuranceCode: row.insuranceCode, item });
      }
    }
  }

  if (inserts.length > 0) {
    await saveSnapshots(inserts);
  }

  await markDone(reqRow.id);
  const sec = Math.round((Date.now() - start) / 1000);
  console.log(`[refresh] 요청 ${reqRow.id} — ${codes.length} codes 처리 (${sec}초)`);
}

async function tick(deps: RefreshPollerDeps): Promise<void> {
  if (processing) return;
  let claimed: ClaimedRequest | null = null;
  try {
    claimed = await claimOldestPending();
  } catch (err) {
    console.error("[refresh] 대기줄 조회 실패:", (err as Error).message);
    return;
  }
  if (!claimed) return;

  processing = true;
  try {
    await processRequest(claimed, deps);
  } catch (err) {
    const msg = (err as Error).message ?? "unknown error";
    console.error(`[refresh] 요청 ${claimed.id} 처리 실패:`, msg);
    await markError(claimed.id, msg).catch(e =>
      console.error(`[refresh] markError 실패 ${claimed!.id}:`, (e as Error).message)
    );
  } finally {
    processing = false;
  }
}

export function startRefreshPoller(deps: RefreshPollerDeps): void {
  if (timer) return;
  if (!hasDb()) {
    console.log("[refresh] DATABASE_URL 미설정 — 대기줄 폴러 시작 안 함");
    return;
  }
  if (process.env.DISABLE_REFRESH_POLLER === "1") {
    console.log("[refresh] DISABLE_REFRESH_POLLER=1 — 폴러 시작 안 함");
    return;
  }
  timer = setInterval(() => {
    tick(deps).catch(err => console.error("[refresh] tick 오류:", (err as Error).message));
  }, POLL_MS);
  // Node 종료를 막지 않도록 unref (다른 타이머/서버가 프로세스를 살려둠).
  timer.unref?.();
  console.log(`[refresh] 대기줄 폴러 시작 — ${POLL_MS}ms 간격, 슬롯대역 ${REFRESH_SLOT_BASE}+`);
}
