/**
 * 키워드 검색량 시트 자동 채움
 *
 * 사용 흐름:
 *   1. 사장님: 시트 「검색량조회」 탭 → A4 부터 키워드 입력 (한 줄에 하나)
 *   2. Lightsail 터미널: npx tsx volume.ts
 *   3. B~F 자동 채워짐 (PC, 모바일, 합계, 경쟁도, 수집일)
 *
 * 시트 자동 생성 (탭 없으면 새로 만듦):
 *   A1 : 안내 문구
 *   A3~F3 : 헤더
 *   A4~ : 키워드 (사장님이 직접 입력)
 *   B4~F4 : 자동 채워짐
 *
 * 매일 자동 갱신 원하시면 cron 등록:
 *   0 9 * * * cd /home/ubuntu/sales/simple && /usr/bin/npx tsx volume.ts >> /home/ubuntu/sales.log 2>&1
 */

import "dotenv/config";
import { createHmac } from "node:crypto";
import { ensureTab, readRange, loadCredsFromEnv, type SheetCreds } from "./sheets";

const SHEET_CREDS: SheetCreds | null = loadCredsFromEnv();
const AD_API_KEY = process.env.NAVER_AD_API_KEY;
const AD_SECRET = process.env.NAVER_AD_SECRET;
const AD_CUSTOMER_ID = process.env.NAVER_AD_CUSTOMER_ID;

const TAB = "검색량조회";
const HEADERS = ["키워드", "PC 월검색", "모바일 월검색", "합계", "경쟁도", "수집일"];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface AdRow {
  relKeyword: string;
  monthlyPcQcCnt: number | string;
  monthlyMobileQcCnt: number | string;
  compIdx: string;
}

function adSign(method: string, path: string, ts: string): string {
  if (!AD_SECRET) throw new Error("NAVER_AD_SECRET 없음");
  return createHmac("sha256", AD_SECRET).update(`${ts}.${method}.${path}`).digest("base64");
}

function num(v: unknown): number {
  if (v === "< 10" || v === undefined || v === null) return 0;
  return Number(v) || 0;
}

async function fetchKeywordTool(hintKeywords: string[]): Promise<AdRow[]> {
  if (!AD_API_KEY || !AD_SECRET || !AD_CUSTOMER_ID) {
    throw new Error("검색광고 API 키 누락 (NAVER_AD_API_KEY/SECRET/CUSTOMER_ID)");
  }
  const path = "/keywordstool";
  const ts = String(Date.now());
  const params = new URLSearchParams({
    hintKeywords: hintKeywords.join(","),
    showDetail: "1",
  });
  const url = `https://api.naver.com${path}?${params}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-Timestamp": ts,
      "X-API-KEY": AD_API_KEY,
      "X-Customer": AD_CUSTOMER_ID,
      "X-Signature": adSign("GET", path, ts),
    },
  });
  if (!res.ok) throw new Error(`keywordstool ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { keywordList?: AdRow[] };
  return data.keywordList ?? [];
}

async function writeRowsRange(creds: SheetCreds, rangeA1: string, rows: (string | number)[][]): Promise<void> {
  // sheets.ts 에 직접 update 함수 없어서 fetch 로 직접 PUT
  const token = await getToken(creds);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${creds.sheetId}/values/${encodeURIComponent(rangeA1)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });
  if (!res.ok) throw new Error(`writeRows ${res.status}: ${await res.text()}`);
}

// sheets.ts 의 getToken 이 export 안 돼있어서 따로 호출 — 간단히 access_token 만 받기
async function getToken(c: SheetCreds): Promise<string> {
  const { createSign, createPrivateKey } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: c.email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const unsigned = `${b64(header)}.${b64(claim)}`;
  const key = createPrivateKey(c.privateKey);
  const sig = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(key)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const jwt = `${unsigned}.${sig}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function main(): Promise<void> {
  if (!SHEET_CREDS) throw new Error("Google Sheet 환경변수 없음");
  if (!AD_API_KEY) throw new Error("검색광고 API 키 없음");

  // 탭 + 헤더 준비
  await ensureTab(SHEET_CREDS, TAB, HEADERS);
  // A1 안내문 (있으면 덮어쓰기)
  await writeRowsRange(SHEET_CREDS, `${TAB}!A1`, [
    ["📌 A4 부터 키워드 입력 → 터미널에서 'npx tsx volume.ts' 실행 → B~F 자동 채워짐"],
  ]);

  // A4 부터 키워드 읽기
  const rows = await readRange(SHEET_CREDS, `${TAB}!A4:A10000`);
  const items: { row: number; keyword: string }[] = [];
  rows.forEach((r, idx) => {
    const k = String(r[0] ?? "").trim();
    if (k) items.push({ row: idx + 4, keyword: k });
  });

  if (items.length === 0) {
    console.log(`⚠️ 「${TAB}」 탭의 A4 부터 키워드를 입력하고 다시 실행하세요.`);
    return;
  }
  console.log(`${items.length}개 키워드 조회 중…`);

  const today = new Date().toISOString().slice(0, 10);
  const BATCH = 5;
  const results = new Map<string, { pc: number; mb: number; comp: string }>();

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH).map((x) => x.keyword);
    process.stdout.write(`  [${i + 1}-${Math.min(i + BATCH, items.length)}/${items.length}] ${batch.join(", ")}: `);
    try {
      const list = await fetchKeywordTool(batch);
      for (const k of batch) {
        const found = list.find((row) => row.relKeyword === k || row.relKeyword === k.replace(/\s+/g, ""));
        if (found) {
          const pc = num(found.monthlyPcQcCnt);
          const mb = num(found.monthlyMobileQcCnt);
          results.set(k, { pc, mb, comp: found.compIdx || "" });
        } else {
          results.set(k, { pc: 0, mb: 0, comp: "데이터없음" });
        }
      }
      console.log("OK");
    } catch (err) {
      console.log(`실패: ${err instanceof Error ? err.message.slice(0, 60) : String(err)}`);
      for (const k of batch) results.set(k, { pc: 0, mb: 0, comp: "오류" });
    }
    await sleep(300);
  }

  // 시트에 한 행씩 쓰기 (행 번호 비연속일 수 있어서)
  for (const item of items) {
    const r = results.get(item.keyword)!;
    await writeRowsRange(SHEET_CREDS, `${TAB}!B${item.row}:F${item.row}`, [
      [r.pc, r.mb, r.pc + r.mb, r.comp, today],
    ]);
  }

  console.log(`\n✅ 완료: ${items.length}개 키워드 시트 갱신.`);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
