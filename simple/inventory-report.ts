/**
 * 재고 보고 — B2C 재고장 시트 read → 「⭐재고이력」 저장 → 텔레그램 발송.
 *
 * 시트 (별도 스프레드시트):
 *   ID: 1TT4w04Etabf1C499icyItbfilWSUGPBlZIBRY76Urf0, gid: 303888745
 *
 * 컬럼:
 *   D = SEASON ("반품" 포함 행 = 반품재고)
 *   AA = 현재고수량 (행별)
 *   AF = 현재고금액 (행별)
 *
 * 텔레그램 메시지: 당일 + 당월초 + 전월초 비교
 *   (스냅샷 누적이 필요해서 첫 보고는 비교 데이터 없음, 다음달부터 정상)
 */

import "dotenv/config";
import {
  ensureTab,
  appendRows,
  readRange,
  writeRange,
  getSheetIdMap,
  loadCredsFromEnv,
  type SheetCreds,
} from "./sheets";

const SHEET_CREDS = loadCredsFromEnv();
if (!SHEET_CREDS) throw new Error("Google Sheet 환경변수 없음");

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

const B2C_INVENTORY_SPREADSHEET_ID = "1TT4w04Etabf1C499icyItbfilWSUGPBlZIBRY76Urf0";
const B2C_INVENTORY_GID = 303888745;

interface Snapshot {
  totalQty: number;
  totalAmount: number;
  returnQty: number;
  returnAmount: number;
}

async function fetchInventory(): Promise<Snapshot | null> {
  const altCreds: SheetCreds = { ...SHEET_CREDS!, sheetId: B2C_INVENTORY_SPREADSHEET_ID };
  const sheetIdMap = await getSheetIdMap(altCreds);
  let tabName: string | undefined;
  for (const [name, gid] of sheetIdMap.entries()) {
    if (gid === B2C_INVENTORY_GID) { tabName = name; break; }
  }
  if (!tabName) {
    console.warn(`B2C 재고장 gid=${B2C_INVENTORY_GID} 탭 못 찾음 — 시트 공유 권한 확인`);
    return null;
  }
  console.log(`[B2C 재고장] 탭 "${tabName}" 에서 읽는 중`);

  const rows = await readRange(altCreds, `${tabName}!A1:AF100000`);
  let totalQty = 0, totalAmount = 0, returnQty = 0, returnAmount = 0;
  let validRows = 0;

  for (const r of rows) {
    const season = String(r[3] ?? "").trim(); // D열
    const qty = Number(String(r[26] ?? "").replace(/,/g, "")) || 0; // AA열
    const amount = Number(String(r[31] ?? "").replace(/,/g, "")) || 0; // AF열
    if (qty === 0 && amount === 0) continue; // 빈 행 + 헤더 행 자동 skip
    validRows++;
    totalQty += qty;
    totalAmount += amount;
    if (season.includes("반품")) {
      returnQty += qty;
      returnAmount += amount;
    }
  }
  console.log(`[B2C 재고장] ${validRows}행 합산`);
  return { totalQty, totalAmount, returnQty, returnAmount };
}

async function saveSnapshot(date: string, snap: Snapshot): Promise<void> {
  await ensureTab(SHEET_CREDS!, "⭐재고이력", ["날짜", "총재고수량", "총재고금액", "반품수량", "반품금액"]);
  const rows = await readRange(SHEET_CREDS!, "⭐재고이력!A2:E10000");
  const idx = rows.findIndex((r) => String(r[0] ?? "") === date);
  const values = [[date, snap.totalQty, snap.totalAmount, snap.returnQty, snap.returnAmount]];
  if (idx >= 0) {
    const rowNum = idx + 2;
    await writeRange(SHEET_CREDS!, `⭐재고이력!A${rowNum}:E${rowNum}`, values);
  } else {
    await appendRows(SHEET_CREDS!, "⭐재고이력!A2", values);
  }
}

async function loadSnapshot(date: string): Promise<Snapshot | null> {
  try {
    const rows = await readRange(SHEET_CREDS!, "⭐재고이력!A2:E10000");
    const row = rows.find((r) => String(r[0] ?? "") === date);
    if (!row) return null;
    return {
      totalQty: Number(row[1]) || 0,
      totalAmount: Number(row[2]) || 0,
      returnQty: Number(row[3]) || 0,
      returnAmount: Number(row[4]) || 0,
    };
  } catch {
    return null;
  }
}

async function sendTelegram(text: string, maxAttempts = 3): Promise<void> {
  if (!TG_TOKEN || !TG_CHAT) {
    console.warn("Telegram 환경변수 없음 — 발송 skip");
    return;
  }
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }),
      });
      if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = now.toISOString().slice(0, 10);
  const thisMonthFirst = `${today.slice(0, 7)}-01`;

  // 전월 1일 계산
  const lastMonthDate = new Date(now);
  lastMonthDate.setUTCDate(1);
  lastMonthDate.setUTCMonth(lastMonthDate.getUTCMonth() - 1);
  const lastMonthFirst = lastMonthDate.toISOString().slice(0, 10);

  // 1) 시트 read
  const snap = await fetchInventory();
  if (!snap) {
    console.log("재고 데이터 없음 — 보고 skip");
    return;
  }
  console.log(`총재고: ${snap.totalQty}개 ${snap.totalAmount.toLocaleString()}원`);
  console.log(`반품재고: ${snap.returnQty}개 ${snap.returnAmount.toLocaleString()}원`);

  // 2) 오늘 스냅샷 저장
  await saveSnapshot(today, snap);

  // 3) 비교 데이터 lookup
  const thisMonthSnap = today === thisMonthFirst ? snap : await loadSnapshot(thisMonthFirst);
  const lastMonthSnap = await loadSnapshot(lastMonthFirst);

  // 4) 텔레그램 메시지
  const won = (n: number) => n.toLocaleString("ko-KR") + "원";
  const lines: string[] = [];
  lines.push(`<b>📦 재고 보고 (${today})</b>`);
  lines.push("");

  lines.push(`<b>━ 당일 (${today}) ━</b>`);
  lines.push(`총재고: ${snap.totalQty.toLocaleString()}개 / ${won(snap.totalAmount)}`);
  lines.push(`반품재고: ${snap.returnQty.toLocaleString()}개 / ${won(snap.returnAmount)}`);

  if (thisMonthSnap && thisMonthFirst !== today) {
    lines.push("");
    lines.push(`<b>━ 당월초 (${thisMonthFirst}) ━</b>`);
    lines.push(`총재고: ${thisMonthSnap.totalQty.toLocaleString()}개 / ${won(thisMonthSnap.totalAmount)}`);
    lines.push(`반품재고: ${thisMonthSnap.returnQty.toLocaleString()}개 / ${won(thisMonthSnap.returnAmount)}`);
  }

  if (lastMonthSnap) {
    lines.push("");
    lines.push(`<b>━ 전월초 (${lastMonthFirst}) ━</b>`);
    lines.push(`총재고: ${lastMonthSnap.totalQty.toLocaleString()}개 / ${won(lastMonthSnap.totalAmount)}`);
    lines.push(`반품재고: ${lastMonthSnap.returnQty.toLocaleString()}개 / ${won(lastMonthSnap.returnAmount)}`);
  }

  if (!thisMonthSnap && !lastMonthSnap) {
    lines.push("");
    lines.push(`<i>※ 첫 보고 — 다음달부터 전월/당월초 비교 표시</i>`);
  }

  await sendTelegram(lines.join("\n"));
  console.log("✅ 재고 보고 텔레그램 발송 완료");
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error("STACK:", err.stack.split("\n").slice(0, 5).join("\n"));
  }
  process.exit(1);
});
