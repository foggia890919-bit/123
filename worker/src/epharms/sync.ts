// 모든 활성 ePharms 계정을 순회하며 매출원장을 긁어 DB에 업서트한다.
// 계정 사이에는 PER_ACCOUNT_DELAY_MS 만큼 대기 → 같은 사이트 부하 분산.

import { chromium, type Browser } from "playwright";
import { fetchLedger, login } from "./adapter.ts";
import {
  decryptPw,
  finishSyncLog,
  loadActiveAccounts,
  startSyncLog,
  upsertLedgerRows,
} from "./db.ts";

const PER_ACCOUNT_DELAY_MS = Number(process.env.EPHARMS_DELAY_MS ?? 5000);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let running = false;

export function isEpharmsSyncRunning(): boolean {
  return running;
}

export interface EpharmsSyncResult {
  total: number;
  ok: number;
  failed: number;
  durationMs: number;
}

export async function runEpharmsSync(opts: { onlyAccountId?: string } = {}): Promise<EpharmsSyncResult> {
  if (running) throw new Error("ePharms sync already running");
  running = true;
  const t0 = Date.now();
  let ok = 0, failed = 0, total = 0;

  let browser: Browser | undefined;
  try {
    let accounts = await loadActiveAccounts();
    if (opts.onlyAccountId) {
      accounts = accounts.filter(a => a.id === opts.onlyAccountId);
    }
    total = accounts.length;
    if (total === 0) {
      console.log("[epharms] no active accounts to sync");
      return { total: 0, ok: 0, failed: 0, durationMs: Date.now() - t0 };
    }

    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });

    for (const acc of accounts) {
      const logId = await startSyncLog(acc.id);
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent: UA,
        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
      });
      // tsx/esbuild가 page.evaluate 콜백에 __name 호출을 삽입함 — 브라우저 stub 주입
      await ctx.addInitScript(() => {
        const g = globalThis as unknown as { __name?: (fn: unknown) => unknown };
        if (typeof g.__name === "undefined") g.__name = (fn) => fn;
      });
      const page = await ctx.newPage();
      try {
        const pw = decryptPw(acc.loginPwEnc);
        await login(page, { loginId: acc.loginId, loginPw: pw });
        const rows = await fetchLedger(page);
        const inserted = await upsertLedgerRows(acc.id, acc.bizNumber, rows);
        await finishSyncLog(logId, acc.id, {
          status: "ok",
          rowsFetched: rows.length,
          rowsInserted: inserted,
        });
        ok++;
        console.log(
          `[epharms] ${acc.clientName}(${acc.bizNumber}) ok — fetched=${rows.length} inserted=${inserted}`
        );
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        await finishSyncLog(logId, acc.id, {
          status: "error",
          rowsFetched: 0,
          rowsInserted: 0,
          error: msg,
        });
        failed++;
        console.error(`[epharms] ${acc.clientName}(${acc.bizNumber}) FAILED — ${msg}`);
      } finally {
        await ctx.close().catch(() => {});
      }
      await new Promise(r => setTimeout(r, PER_ACCOUNT_DELAY_MS));
    }
  } finally {
    await browser?.close().catch(() => {});
    running = false;
  }

  const durationMs = Date.now() - t0;
  console.log(`[epharms] done — total=${total} ok=${ok} failed=${failed} ${durationMs}ms`);
  return { total, ok, failed, durationMs };
}
