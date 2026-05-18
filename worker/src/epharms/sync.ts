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
let syncGen = 0; // 강제 재시작 시 세대 번호 증가 → 구형 hung sync의 finally가 플래그를 덮어쓰지 못하게 함

export function isEpharmsSyncRunning(): boolean {
  return running;
}

export function forceResetSync(): void {
  syncGen++;      // 구형 sync 무효화
  running = false;
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
  const myGen = syncGen; // 이 실행의 세대 번호를 기억
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
    if (syncGen === myGen) running = false; // 강제 재시작으로 세대가 바뀌었으면 리셋 생략
  }

  const durationMs = Date.now() - t0;
  console.log(`[epharms] done — total=${total} ok=${ok} failed=${failed} ${durationMs}ms`);
  return { total, ok, failed, durationMs };
}
