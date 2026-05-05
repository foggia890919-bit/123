// 매일 자정(KST) 자동 ePharms sync. 단일 인스턴스 보장.
// 순서: 상품마스터 → 매출원장 (상품마스터가 완료돼야 원장 가격 매핑 가능)

import cron from "node-cron";
import { isEpharmsSyncRunning, runEpharmsSync } from "./sync.ts";
import { isProductSyncRunning, syncProductMaster } from "./products.ts";
import { hasDb } from "../db.ts";

let scheduled: ReturnType<typeof cron.schedule> | undefined;

export function startEpharmsScheduler(): void {
  if (scheduled) return;
  if (process.env.DISABLE_EPHARMS_SCHEDULER === "1") {
    console.log("[epharms-cron] DISABLE_EPHARMS_SCHEDULER=1 — not registering");
    return;
  }
  if (!hasDb()) {
    console.warn("[epharms-cron] DATABASE_URL not set — not registering");
    return;
  }
  const expr = process.env.EPHARMS_SCHEDULE_CRON ?? "0 0 * * *"; // daily 00:00 KST
  scheduled = cron.schedule(
    expr,
    async () => {
      if (isEpharmsSyncRunning() || isProductSyncRunning()) {
        console.warn("[epharms-cron] previous run still in progress — skipping");
        return;
      }
      // 1단계: 상품마스터 동기화
      try {
        console.log("[epharms-cron] starting product master sync");
        await syncProductMaster();
      } catch (err) {
        console.error("[epharms-cron] product sync failed:", err);
      }
      // 2단계: 매출원장 동기화
      try {
        console.log("[epharms-cron] starting ledger sync");
        await runEpharmsSync();
      } catch (err) {
        console.error("[epharms-cron] ledger sync failed:", err);
      }
    },
    { timezone: "Asia/Seoul" }
  );
  console.log(`[epharms-cron] registered "${expr}" (Asia/Seoul)`);
}
