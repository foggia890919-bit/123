/**
 * 시트 「자동화」 탭의 「실행」 칼럼을 1분 마다 폴링.
 * 사장님이 셀에 「GO」 또는 날짜 등을 입력 → 자동 실행 → 결과 칼럼에 표시.
 *
 * 시트 「자동화」:
 *   A: 작업명 (코드가 자동 등록)
 *   B: 실행 (사장님이 「GO」, 「실행」, 「YYYY-MM-DD YYYY-MM-DD」 등 입력)
 *   C: 상태 (RUNNING, OK, ERROR)
 *   D: 마지막 실행 시각
 *   E: 결과 메시지
 *
 * 사용법:
 *   1. crontab -e 에 추가:
 *        * * * * * cd /home/ubuntu/sales/simple && /usr/bin/npx tsx scheduler.ts >> /home/ubuntu/sales.log 2>&1
 *   2. 시트 「자동화」 탭의 B열에 「GO」 입력
 *   3. 1분 이내 자동 실행, 결과 자동 입력
 */

import "dotenv/config";
import { execSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { ensureTab, readRange, writeRange, loadCredsFromEnv, type SheetCreds } from "./sheets";

const SHEET_CREDS: SheetCreds | null = loadCredsFromEnv();
if (!SHEET_CREDS) throw new Error("Google Sheet 환경변수 없음");

const TAB = "자동화";
const WORKDIR = process.env.SALES_DIR ?? "/home/ubuntu/sales/simple";
const LOCK_FILE = "/tmp/sales-scheduler.lock";
const LOCK_STALE_MS = 2 * 60 * 60 * 1000; // 2시간 — stale lock 자동 제거

interface TaskDef {
  name: string;
  cmd: string; // 「DATE_RANGE」 또는 「DATE_SINGLE」 도 가능
  hint: string; // B열 「실행」 입력 힌트
}

const TASKS: TaskDef[] = [
  { name: "매출 — 어제 + 7일 롤링 (cron 자동)", cmd: "npx tsx run.ts", hint: "GO" },
  { name: "매출 — 단일 날짜", cmd: "DATE_SINGLE", hint: "YYYY-MM-DD" },
  { name: "매출 — 날짜 범위 백필", cmd: "DATE_RANGE", hint: "YYYY-MM-DD YYYY-MM-DD" },
  { name: "상품 카탈로그 갱신", cmd: "npx tsx catalog.ts", hint: "GO" },
  { name: "키워드 검색량 갱신", cmd: "npx tsx volume.ts", hint: "GO" },
  { name: "시장 카테고리 트리", cmd: "npx tsx market.ts tree", hint: "GO" },
  { name: "시장 키워드 (Top500)", cmd: "npx tsx market.ts keywords", hint: "GO" },
  { name: "시장 규모 (Top40 매출)", cmd: "npx tsx market.ts size", hint: "GO" },
  { name: "순위 추적", cmd: "npx tsx market.ts rank", hint: "GO" },
];

const TRIGGER_VALUES = new Set(["go", "실행", "y", "yes", "ㅇ", "ㅇㅇ", "1", "✓", "true"]);
const RUNNING = "RUNNING";

function nowKst(): string {
  const d = new Date();
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(d);
}

/** 시트에 작업 행이 모두 있도록 보장 (없는 작업 추가) */
async function ensureTasks(): Promise<void> {
  await ensureTab(SHEET_CREDS!, TAB, ["작업", "실행 (트리거)", "상태", "마지막 실행", "결과"]);
  const existing = await readRange(SHEET_CREDS!, `${TAB}!A2:A100`);
  const existingNames = new Set(existing.map((r) => String(r[0] ?? "").trim()).filter(Boolean));
  // 누락된 작업 append
  let nextRow = existing.length + 2;
  for (const t of TASKS) {
    if (!existingNames.has(t.name)) {
      await writeRange(SHEET_CREDS!, `${TAB}!A${nextRow}:E${nextRow}`, [
        [t.name, "", "", "", `힌트: ${t.hint}`],
      ]);
      nextRow++;
    }
  }
}

async function pollAndRun(): Promise<void> {
  const rows = await readRange(SHEET_CREDS!, `${TAB}!A2:E100`);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[0] ?? "").trim();
    const triggerRaw = String(r[1] ?? "").trim();
    if (!name || !triggerRaw) continue;
    if (triggerRaw === RUNNING) continue; // 이미 실행 중

    const task = TASKS.find((t) => t.name === name);
    if (!task) continue;

    const rowNum = i + 2;

    // 체크박스 트리거? (TRUE 면 체크박스, 그 외 텍스트 입력)
    const isCheckbox = triggerRaw === "TRUE";
    const clearVal: string | boolean = isCheckbox ? false : "";

    // 실행 명령 결정
    let cmd = task.cmd;
    if (task.cmd === "DATE_RANGE") {
      const parts = triggerRaw.split(/\s+/);
      if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0]) || !/^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
        await writeRange(SHEET_CREDS!, `${TAB}!B${rowNum}:E${rowNum}`, [
          [clearVal, "ERROR", nowKst(), `형식 오류: 「${task.hint}」 형태로 입력`],
        ]);
        continue;
      }
      cmd = `npx tsx run.ts ${parts[0]} ${parts[1]}`;
    } else if (task.cmd === "DATE_SINGLE") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(triggerRaw)) {
        await writeRange(SHEET_CREDS!, `${TAB}!B${rowNum}:E${rowNum}`, [
          [clearVal, "ERROR", nowKst(), `형식 오류: ${task.hint} 형태로 입력`],
        ]);
        continue;
      }
      cmd = `npx tsx run.ts ${triggerRaw}`;
    } else {
      // GO / 실행 / TRUE(체크박스) 등 트리거값 검증
      if (!TRIGGER_VALUES.has(triggerRaw.toLowerCase())) {
        await writeRange(SHEET_CREDS!, `${TAB}!B${rowNum}:E${rowNum}`, [
          [clearVal, "ERROR", nowKst(), `「GO」 또는 ☑️ 체크박스 입력`],
        ]);
        continue;
      }
    }

    // RUNNING 표시
    await writeRange(SHEET_CREDS!, `${TAB}!B${rowNum}:E${rowNum}`, [
      [triggerRaw, RUNNING, nowKst(), ""],
    ]);

    console.log(`[${nowKst()}] ▶ ${name}: ${cmd}`);
    try {
      execSync(cmd, { cwd: WORKDIR, stdio: "inherit", timeout: 90 * 60 * 1000 });
      await writeRange(SHEET_CREDS!, `${TAB}!B${rowNum}:E${rowNum}`, [
        [clearVal, "OK", nowKst(), `✅ 완료 ${nowKst()}`],
      ]);
      console.log(`[${nowKst()}] ✅ ${name} 완료`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
      await writeRange(SHEET_CREDS!, `${TAB}!B${rowNum}:E${rowNum}`, [
        [clearVal, "ERROR", nowKst(), `❌ ${msg}`],
      ]);
      console.error(`[${nowKst()}] ❌ ${name}: ${msg}`);
    }
  }
}

async function main(): Promise<void> {
  // 중복 실행 방지 — lock file
  if (existsSync(LOCK_FILE)) {
    const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
    if (age < LOCK_STALE_MS) {
      console.log(`[scheduler] 이미 실행 중 (lock ${Math.round(age / 1000)}초 전). skip.`);
      return;
    }
    console.log(`[scheduler] stale lock 제거 (${Math.round(age / 60000)}분 경과)`);
    unlinkSync(LOCK_FILE);
  }
  writeFileSync(LOCK_FILE, String(process.pid));
  try {
    await ensureTasks();
    await pollAndRun();
  } finally {
    if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);
  }
}

main().catch((err) => {
  console.error("[scheduler] FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
