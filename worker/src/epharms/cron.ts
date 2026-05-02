// 매일 자정(KST) 자동 ePharms sync. 단일 인스턴스 보장.

import cron from "node-cron";
import { isEpharmsSyncRunning, runEpharmsSync } from "./sync.ts";
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
      if (isEpharmsSyncRunning()) {
        console.warn("[epharms-cron] previous run still in progress — skipping");
        return;
      }
      try {
        await runEpharmsSync();
      } catch (err) {
        console.error("[epharms-cron] run failed:", err);
      }
    },
    { timezone: "Asia/Seoul" }
  );
  console.log(`[epharms-cron] registered "${expr}" (Asia/Seoul)`);
}
