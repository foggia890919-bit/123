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
import {
  ensureTab,
  readRange,
  writeRange,
  setCheckboxValidation,
  setDateValidation,
  getSheetIdMap,
  loadCredsFromEnv,
  type SheetCreds,
} from "./sheets";

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
  resultSheet?: string; // F열 (결과 시트) 하이퍼링크
  inputSheet?: string; // G열 (입력 필요한 시트) 하이퍼링크 — ⭐ 표시
}

const STOP_TASK_NAME = "🛑 작업 중단 (실행 중인 작업 강제 종료)";

const TASKS: TaskDef[] = [
  { name: "매출 — 어제 + 7일 롤링 (cron 자동)", cmd: "npx tsx run.ts", hint: "GO", resultSheet: "주문원본" },
  { name: "매출 — 단일 날짜", cmd: "DATE_SINGLE", hint: "YYYY-MM-DD", resultSheet: "주문원본" },
  { name: "매출 — 날짜 범위 백필", cmd: "DATE_RANGE", hint: "YYYY-MM-DD YYYY-MM-DD", resultSheet: "주문원본" },
  { name: "상품 카탈로그 갱신", cmd: "npx tsx catalog.ts", hint: "GO", resultSheet: "상품목록" },
  { name: "키워드 검색량 갱신", cmd: "npx tsx volume.ts", hint: "GO", resultSheet: "검색량조회", inputSheet: "검색량조회" },
  { name: "시장 카테고리 트리", cmd: "npx tsx market.ts tree", hint: "GO", resultSheet: "시장조사_카테고리" },
  { name: "시장 키워드 (Top500)", cmd: "npx tsx market.ts keywords", hint: "GO", resultSheet: "시장조사_키워드", inputSheet: "⭐시장조사_키워드_추적" },
  { name: "시장 규모 (Top40 매출)", cmd: "npx tsx market.ts size", hint: "GO", resultSheet: "시장조사_시장규모", inputSheet: "⭐시장조사_시장규모_추적" },
  { name: "순위 추적", cmd: "npx tsx market.ts rank", hint: "GO", resultSheet: "순위추적_데이터", inputSheet: "⭐순위추적_상품" },
  { name: "📦 재고 보고 (B2C 재고장)", cmd: "npx tsx inventory-report.ts", hint: "GO", resultSheet: "⭐재고이력" },
  { name: STOP_TASK_NAME, cmd: "STOP", hint: "GO" },
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

/** 시트에 작업 행이 모두 있도록 보장 (없는 작업 추가) + GO 행에 체크박스 자동 설정 + F열에 결과 시트 하이퍼링크 */
async function ensureTasks(): Promise<void> {
  await ensureTab(SHEET_CREDS!, TAB, [
    "작업",
    "실행 (트리거)",
    "상태",
    "클릭 시점",
    "마지막 실행",
    "결과",
    "결과 시트",
    "⭐ 입력 시트",
    "📅 끝 날짜 (범위 백필 전용)",
  ]);
  // ⭐옵션매핑 시트 미리 생성 (사장님이 매출 작업 안 돌려도 헤더 보이게)
  await ensureTab(SHEET_CREDS!, "⭐옵션매핑", [
    "원본상품번호",
    "채널상품번호",
    "옵션관리번호",
    "라벨",
    "원가(개당)",
    "물류비(건당)",
    "유형(메인/추가)",
  ]);
  const existing = await readRange(SHEET_CREDS!, `${TAB}!A2:A100`);
  const existingNames = new Set(existing.map((r) => String(r[0] ?? "").trim()).filter(Boolean));
  // 누락된 작업 append — 행 번호도 추적 (체크박스용)
  const taskRows = new Map<string, number>(); // 작업명 → 행 번호 (1-based)
  existing.forEach((r, idx) => {
    const name = String(r[0] ?? "").trim();
    if (name) taskRows.set(name, idx + 2);
  });
  let nextRow = existing.length + 2;
  for (const t of TASKS) {
    if (!existingNames.has(t.name)) {
      // A: 작업, B: 트리거, C: 상태, D: 클릭 시점(Apps Script 박음), E: 마지막 실행, F: 결과
      await writeRange(SHEET_CREDS!, `${TAB}!A${nextRow}:F${nextRow}`, [
        [t.name, "", "", "", "", `힌트: ${t.hint}`],
      ]);
      taskRows.set(t.name, nextRow);
      nextRow++;
    }
  }

  // GO 트리거 작업 행의 B열에 체크박스 자동 설정 (DATE_* 는 텍스트 입력이라 제외)
  const checkboxRows = TASKS
    .filter((t) => t.hint === "GO")
    .map((t) => taskRows.get(t.name))
    .filter((n): n is number => typeof n === "number");
  if (checkboxRows.length > 0) {
    try {
      await setCheckboxValidation(SHEET_CREDS!, TAB, checkboxRows, 1); // B열 = index 1
    } catch (e) {
      console.warn(`[scheduler] 체크박스 설정 실패 (무시하고 진행): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // DATE_SINGLE / DATE_RANGE 행에 날짜 picker (달력) 적용
  // DATE_SINGLE: B 에 단일 달력
  // DATE_RANGE: B (시작 날짜) + I (끝 날짜) 두 셀 달력
  try {
    for (const t of TASKS) {
      const rowNum = taskRows.get(t.name);
      if (!rowNum) continue;
      if (t.cmd === "DATE_SINGLE") {
        await setDateValidation(SHEET_CREDS!, TAB, rowNum, 1); // B
      } else if (t.cmd === "DATE_RANGE") {
        await setDateValidation(SHEET_CREDS!, TAB, rowNum, 1); // B = 시작
        await setDateValidation(SHEET_CREDS!, TAB, rowNum, 8); // I = 끝
      }
    }
  } catch (e) {
    console.warn(`[scheduler] 날짜 달력 설정 실패 (무시): ${e instanceof Error ? e.message : String(e)}`);
  }

  // F (결과 시트) + G (입력 시트 ⭐) 하이퍼링크 작성
  try {
    const sheetIdMap = await getSheetIdMap(SHEET_CREDS!);
    const spreadsheetBase = `https://docs.google.com/spreadsheets/d/${SHEET_CREDS!.sheetId}/edit#gid=`;
    const makeLink = (name: string): string | null => {
      const gid = sheetIdMap.get(name);
      if (gid === undefined) return null;
      return `=HYPERLINK("${spreadsheetBase}${gid}", "${name}")`;
    };
    for (const t of TASKS) {
      const rowNum = taskRows.get(t.name);
      if (!rowNum) continue;
      const gLink = t.resultSheet ? makeLink(t.resultSheet) : null;  // 결과 시트는 G열
      const hLink = t.inputSheet ? makeLink(t.inputSheet) : null;    // 입력 시트는 H열
      if (gLink) await writeRange(SHEET_CREDS!, `${TAB}!G${rowNum}`, [[gLink]]);
      if (hLink) await writeRange(SHEET_CREDS!, `${TAB}!H${rowNum}`, [[hLink]]);
    }
  } catch (e) {
    console.warn(`[scheduler] F·G열 하이퍼링크 작성 실패 (무시): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 다양한 날짜 형식 → "YYYY-MM-DD" 정규화 (달력 입력 / 텍스트 / "2026. 05. 13." 모두 처리) */
function normalizeDate(s: string): string {
  const m = String(s).trim().match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

async function pollAndRun(): Promise<void> {
  const rows = await readRange(SHEET_CREDS!, `${TAB}!A2:I100`);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[0] ?? "").trim();
    const triggerRaw = String(r[1] ?? "").trim();
    const statusRaw = String(r[2] ?? "").trim();
    if (!name || !triggerRaw) continue;
    if (triggerRaw === "FALSE") continue; // 체크박스 unchecked = 트리거 아님 (트리거값 검증 실패 → 무한 ERROR 루프 방지)
    if (statusRaw === RUNNING) continue;  // 상태(C열)가 RUNNING — 이전 실행이 비정상 종료(OOM 등). 사장님 수동 정리 대기

    const task = TASKS.find((t) => t.name === name);
    if (!task) continue;
    if (task.cmd === "STOP") continue; // STOP 은 main 의 checkAndHandleStop 에서 처리

    const rowNum = i + 2;

    // 체크박스 트리거? (TRUE 면 체크박스, 그 외 텍스트 입력)
    const isCheckbox = triggerRaw === "TRUE";
    const clearVal: string | boolean = isCheckbox ? false : "";

    // 실행 명령 결정 — B:C (트리거/상태) + E:F (마지막 실행/결과) 별도 write (D 클릭 시점 보존)
    const writeRow = async (trigger: string | boolean, status: string, result: string) => {
      await writeRange(SHEET_CREDS!, `${TAB}!B${rowNum}:C${rowNum}`, [[trigger, status]]);
      await writeRange(SHEET_CREDS!, `${TAB}!E${rowNum}:F${rowNum}`, [[nowKst(), result]]);
    };

    let cmd = task.cmd;
    if (task.cmd === "DATE_RANGE") {
      // B = 시작 날짜 (달력), I = 끝 날짜 (달력)
      const fromDate = normalizeDate(triggerRaw);
      const toDate = normalizeDate(String(r[8] ?? "")); // I 컬럼 (0-based 8)
      if (!fromDate || !toDate) {
        await writeRow(clearVal, "ERROR", `B(시작) + I(끝) 두 셀 모두 달력으로 날짜 선택해주세요`);
        continue;
      }
      cmd = `npx tsx run.ts ${fromDate} ${toDate}`;
    } else if (task.cmd === "DATE_SINGLE") {
      const date = normalizeDate(triggerRaw);
      if (!date) {
        await writeRow(clearVal, "ERROR", `B 셀에 달력으로 날짜 선택해주세요`);
        continue;
      }
      cmd = `npx tsx run.ts ${date}`;
    } else {
      // GO / 실행 / TRUE(체크박스) 등 트리거값 검증
      if (!TRIGGER_VALUES.has(triggerRaw.toLowerCase())) {
        await writeRow(clearVal, "ERROR", `「GO」 또는 ☑️ 체크박스 입력`);
        continue;
      }
    }

    // RUNNING 표시
    await writeRow(triggerRaw, RUNNING, "");

    console.log(`[${nowKst()}] ▶ ${name}: ${cmd}`);
    try {
      execSync(cmd, { cwd: WORKDIR, stdio: "inherit", timeout: 90 * 60 * 1000 });
      await writeRow(clearVal, "OK", `✅ 완료 ${nowKst()}`);
      // DATE_RANGE 끝나면 I (끝 날짜) 도 비움 — 다음 트리거를 위해
      if (task.cmd === "DATE_RANGE") {
        await writeRange(SHEET_CREDS!, `${TAB}!I${rowNum}`, [[""]]);
      }
      console.log(`[${nowKst()}] ✅ ${name} 완료`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
      await writeRow(clearVal, "ERROR", `❌ ${msg}`);
      if (task.cmd === "DATE_RANGE") {
        await writeRange(SHEET_CREDS!, `${TAB}!I${rowNum}`, [[""]]);
      }
      console.error(`[${nowKst()}] ❌ ${name}: ${msg}`);
    }
  }
}

/** STOP 트리거 우선 처리 (lock 무관) — 도는 tsx 프로세스 강제 종료 + 다른 ☑/RUNNING 행 모두 정리 */
async function checkAndHandleStop(): Promise<boolean> {
  try {
    const rows = await readRange(SHEET_CREDS!, `${TAB}!A2:F100`);
    let stopRowNum = 0;
    for (let i = 0; i < rows.length; i++) {
      const name = String(rows[i][0] ?? "").trim();
      const trigger = String(rows[i][1] ?? "").trim();
      if (name !== STOP_TASK_NAME) continue;
      if (trigger === "FALSE" || !trigger) return false;
      if (trigger !== "TRUE" && !TRIGGER_VALUES.has(trigger.toLowerCase())) return false;
      stopRowNum = i + 2;
      break;
    }
    if (!stopRowNum) return false;

    console.log(`[scheduler] 🛑 STOP 트리거 — tsx 프로세스 강제 종료 시도`);
    try {
      execSync(`pkill -f "tsx (run|catalog|market|volume)\\.ts" || true`, { stdio: "inherit" });
    } catch (e) {
      console.error(`[scheduler] pkill 실패 (무시): ${e instanceof Error ? e.message : e}`);
    }
    if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);

    // 다른 행 정리 — 트리거 ☑/텍스트 있거나 RUNNING 상태인 행 모두 ERROR 로 마킹 + 체크박스 해제
    const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
    for (let i = 0; i < rows.length; i++) {
      const name = String(rows[i][0] ?? "").trim();
      if (!name || name === STOP_TASK_NAME) continue;
      const trigger = String(rows[i][1] ?? "").trim();
      const status = String(rows[i][2] ?? "").trim();
      const rowNum = i + 2;
      const isCheckbox = trigger === "TRUE";
      const isTriggered =
        trigger === "TRUE" ||
        TRIGGER_VALUES.has(trigger.toLowerCase()) ||
        DATE_RE.test(trigger);
      if (isTriggered || status === RUNNING) {
        const clearVal: string | boolean = isCheckbox ? false : "";
        await writeRange(SHEET_CREDS!, `${TAB}!B${rowNum}:C${rowNum}`, [[clearVal, "ERROR"]]);
        await writeRange(SHEET_CREDS!, `${TAB}!E${rowNum}:F${rowNum}`, [[nowKst(), `🛑 STOP 으로 중단됨 ${nowKst()}`]]);
      }
    }

    // STOP 행 자체 정리
    await writeRange(SHEET_CREDS!, `${TAB}!B${stopRowNum}:C${stopRowNum}`, [[false, "OK"]]);
    await writeRange(SHEET_CREDS!, `${TAB}!E${stopRowNum}:F${stopRowNum}`, [[nowKst(), `🛑 강제 종료 완료 ${nowKst()}`]]);
    return true;
  } catch (err) {
    console.error(`[scheduler] STOP 체크 실패 (무시): ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function main(): Promise<void> {
  // STOP 우선 처리 — lock 무관. 사장님이 도는 작업 강제 종료할 때
  const stopped = await checkAndHandleStop();
  if (stopped) {
    console.log(`[scheduler] STOP 처리 완료. 종료.`);
    return;
  }

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
