// KMD 재고 크롤러 감시자(supervisor).
//
// 배경: 2026-07-30 16:24 크롤러가 아무 로그도 남기지 않고 죽은 뒤 8월 6일까지
// 아무도 되살리지 않았다. 원인은 코드 결함이 아니라 "외부에서 죽으면 끝"이라는 구조였다:
//   - start-worker.bat 이 npm start 를 딱 한 번 실행하고 끝났다 → 죽으면 영구 정지.
//   - 자동 시작은 로그온 시 1회 실행되는 시작프로그램 VBS 뿐 → PC 를 재부팅하지 않으면
//     되살아날 기회 자체가 없다 (실제로 마지막 재부팅은 7/21 이었다).
//   - worker.log 는 무한 append 로 206MB 까지 자랐다.
//
// 이 감시자가 하는 일:
//   1) 중복 실행 방지 — 이미 /health 가 응답하면 조용히 종료한다.
//   2) 로그 회전 — worker.log 가 임계치를 넘으면 타임스탬프 파일로 밀어내고 오래된 것부터 지운다.
//   3) 자식(worker) 이 어떤 이유로든 종료되면 백오프를 두고 자동 재시작한다.
//      정상 가동 시간이 충분했으면 백오프를 초기화해 "오래 돌다 한 번 죽음"과
//      "뜨자마자 죽는 크래시 루프"를 구분한다.
//
// 자식은 npm/cmd 를 거치지 않고 node → tsx CLI 를 직접 띄운다(신호·종료코드가 그대로 전달됨).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = path.join(WORKER_DIR, "logs");
const LOG_FILE = path.join(LOG_DIR, "worker.log");
const TSX_CLI = path.join(WORKER_DIR, "node_modules", "tsx", "dist", "cli.mjs");
const ENTRY = path.join("src", "server.ts");

// 로그 회전: 이 크기를 넘으면 밀어내고, 보관 개수를 넘는 오래된 파일은 지운다.
const MAX_LOG_BYTES = Number(process.env.WORKER_LOG_MAX_BYTES ?? 50 * 1024 * 1024);
const KEEP_ARCHIVES = Number(process.env.WORKER_LOG_KEEP ?? 5);

// 재시작 백오프. 이 시간 이상 정상 가동했으면 "일시적 사고"로 보고 백오프를 초기화한다.
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60_000;
const HEALTHY_RUN_MS = 5 * 60_000;

let logStream = null;
let child = null;
let stopping = false;

function ts() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function log(msg) {
  const line = `[${ts()}] [supervisor] ${msg}\n`;
  process.stdout.write(line);
  logStream?.write(line);
}

function openLog() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
}

function closeLog() {
  return new Promise(resolve => {
    if (!logStream) return resolve();
    const s = logStream;
    logStream = null;
    s.end(resolve);
  });
}

// 회전은 반드시 로그 스트림이 닫힌 상태에서 호출해야 한다(Windows 는 열린 파일 rename 실패).
function rotateIfNeeded() {
  let size = 0;
  try {
    size = fs.statSync(LOG_FILE).size;
  } catch {
    return; // 아직 파일 없음
  }
  if (size < MAX_LOG_BYTES) return;

  const archive = path.join(LOG_DIR, `worker-${stamp()}.log`);
  try {
    fs.renameSync(LOG_FILE, archive);
  } catch (e) {
    // 다른 프로세스가 잡고 있으면 회전을 포기하되 기동은 계속한다.
    process.stdout.write(`[${ts()}] [supervisor] 로그 회전 실패(무시): ${e.message}\n`);
    return;
  }

  try {
    const olds = fs
      .readdirSync(LOG_DIR)
      .filter(f => /^worker-\d{8}-\d{6}\.log$/.test(f))
      .sort();
    for (const f of olds.slice(0, Math.max(0, olds.length - KEEP_ARCHIVES))) {
      fs.unlinkSync(path.join(LOG_DIR, f));
    }
  } catch {
    // 정리 실패는 치명적이지 않다.
  }
}

// .env 의 PORT 를 읽어 중복 실행 여부를 판정한다(server.ts 와 같은 포트를 봐야 함).
function resolvePort() {
  if (process.env.PORT) return Number(process.env.PORT);
  try {
    const raw = fs.readFileSync(path.join(WORKER_DIR, ".env"), "utf8");
    const m = raw.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    if (m) return Number(m[1]);
  } catch {
    // 무시 — 기본값 사용
  }
  return 8080;
}

async function alreadyRunning(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function runChild() {
  return new Promise(resolve => {
    child = spawn(process.execPath, [TSX_CLI, ENTRY], {
      cwd: WORKER_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", d => logStream?.write(d));
    child.stderr.on("data", d => logStream?.write(d));
    child.once("error", e => {
      log(`자식 프로세스 실행 실패: ${e.message}`);
      child = null;
      resolve(null);
    });
    child.once("exit", (code, signal) => {
      child = null;
      resolve(signal ? `signal ${signal}` : code);
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const port = resolvePort();

  if (await alreadyRunning(port)) {
    process.stdout.write(`[${ts()}] [supervisor] 워커가 이미 :${port} 에서 동작 중 — 감시자 종료\n`);
    return;
  }

  if (!fs.existsSync(TSX_CLI)) {
    process.stdout.write(`[${ts()}] [supervisor] tsx 가 없습니다(${TSX_CLI}). worker 에서 npm install 필요\n`);
    process.exitCode = 1;
    return;
  }

  let delay = BASE_DELAY_MS;
  let attempt = 1;

  while (!stopping) {
    await closeLog();
    rotateIfNeeded();
    openLog();

    log(`worker 기동 (시도 ${attempt}, 포트 ${port})`);
    const startedAt = Date.now();
    const result = await runChild();
    const ranMs = Date.now() - startedAt;

    if (stopping) {
      log(`worker 종료 (${result}) — 감시자도 종료`);
      break;
    }

    log(`worker 종료 (${result}) — 가동 ${Math.round(ranMs / 1000)}초`);

    if (ranMs >= HEALTHY_RUN_MS) {
      delay = BASE_DELAY_MS;
      attempt = 1;
    } else {
      delay = Math.min(delay * 2, MAX_DELAY_MS);
      attempt += 1;
    }

    log(`${Math.round(delay / 1000)}초 후 재시작`);
    await sleep(delay);
  }

  await closeLog();
}

function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log(`${sig} 수신 — 자식 종료 후 감시자 종료`);
  child?.kill();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch(async err => {
  log(`감시자 오류: ${err?.stack ?? err}`);
  await closeLog();
  process.exitCode = 1;
});
