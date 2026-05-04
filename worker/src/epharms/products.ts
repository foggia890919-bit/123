// 이팜스 상품 마스터 자동 동기화.
// 마스터 계정으로 로그인 → "상품주문" 페이지 → "전체엑셀다운" 버튼 클릭 →
// xlsx 파일 다운로드 → Vercel API로 multipart 업로드 → DB 저장.

import { chromium, type Browser } from "playwright";
import { readFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Pool } from "pg";
import { login } from "./adapter.ts";
import { decryptPw } from "./db.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://yk.ep45.co.kr";

let running = false;
export function isProductSyncRunning(): boolean { return running; }

const url = process.env.DATABASE_URL;
let pool: Pool | undefined;
function getPool(): Pool {
  if (!url) throw new Error("DATABASE_URL not set");
  if (!pool) pool = new Pool({ connectionString: url, max: 2 });
  return pool;
}

interface MasterAccount {
  id: string;
  bizNumber: string;
  clientName: string;
  loginId: string;
  loginPwEnc: string;
}

async function loadMasterAccount(): Promise<MasterAccount | null> {
  const { rows } = await getPool().query<MasterAccount>(
    `SELECT "id","bizNumber","clientName","loginId","loginPwEnc"
       FROM "EpharmsAccount"
      WHERE "active" = true AND "isMaster" = true
      LIMIT 1`
  );
  if (rows.length > 0) return rows[0];
  // fallback: 첫 활성 계정
  const { rows: fallback } = await getPool().query<MasterAccount>(
    `SELECT "id","bizNumber","clientName","loginId","loginPwEnc"
       FROM "EpharmsAccount"
      WHERE "active" = true
      ORDER BY "createdAt" ASC
      LIMIT 1`
  );
  return fallback[0] ?? null;
}

interface SyncOptions {
  triggeredBy?: string;
  // POST 받을 Vercel API URL (xlsx 파일 업로드)
  uploadUrl: string;
  uploadToken: string;
}

export interface ProductSyncResult {
  status: "ok" | "error";
  filePath?: string;
  fileSize?: number;
  uploadStatus?: number;
  uploadResponse?: unknown;
  error?: string;
}

/**
 * 이팜스 마스터 계정으로 로그인 → 상품 주문 페이지 → "전체엑셀다운" 클릭 →
 * 파일 다운로드 → Vercel API로 binary 업로드.
 *
 * 다운로드는 무거운 페이지라 60s 타임아웃까지 기다림.
 */
export async function syncProductMaster(opts: SyncOptions): Promise<ProductSyncResult> {
  if (running) throw new Error("product sync already running");
  running = true;

  const tempDir = join(tmpdir(), `epharms-products-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  let browser: Browser | undefined;
  try {
    const acc = await loadMasterAccount();
    if (!acc) {
      return { status: "error", error: "활성화된 ePharms 계정이 없습니다. 먼저 마스터 계정을 등록하세요." };
    }
    console.log(`[products] using account: ${acc.clientName} (${acc.bizNumber})`);

    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: UA,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      acceptDownloads: true,
    });
    const page = await ctx.newPage();

    await login(page, { loginId: acc.loginId, loginPw: decryptPw(acc.loginPwEnc) });
    console.log("[products] logged in");

    // 상품 주문 페이지로 이동 (URL은 캡쳐 보고 추정 — /goods/ 또는 /order/)
    // 페이지 구조: 좌측 상품 검색, 우측 카트, 상단에 "전체엑셀다운" 버튼.
    // 정확한 URL 모를 경우 가능한 후보 시도.
    const candidates = [
      `${BASE}/goods/goods_list`,
      `${BASE}/order/order_list`,
      `${BASE}/goods/list`,
    ];
    let landed = false;
    for (const u of candidates) {
      const r = await page.goto(u, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
      if (r && r.ok()) {
        // "전체엑셀다운" 버튼이 있으면 진짜 상품 페이지
        if (await page.locator('button:has-text("전체엑셀다운"), a:has-text("전체엑셀다운")').first().count() > 0) {
          landed = true;
          console.log(`[products] landed on ${u}`);
          break;
        }
      }
    }
    if (!landed) {
      // 메뉴 사이드바에서 "상품검색" 또는 "상품주문" 클릭으로 우회
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const menu = page.locator('a:has-text("상품검색"), a:has-text("상품주문")').first();
      if (await menu.count() > 0) {
        await menu.click();
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        landed = await page.locator('button:has-text("전체엑셀다운"), a:has-text("전체엑셀다운")').first().count() > 0;
      }
    }
    if (!landed) {
      return { status: "error", error: '상품주문 페이지에서 "전체엑셀다운" 버튼을 찾지 못했습니다.' };
    }

    // 다운로드 트리거 + 대기
    console.log("[products] clicking 전체엑셀다운 — this can take several minutes...");
    const dlPromise = page.waitForEvent("download", { timeout: 600_000 }); // 10분
    await page.locator('button:has-text("전체엑셀다운"), a:has-text("전체엑셀다운")').first().click();
    const download = await dlPromise;
    const filename = download.suggestedFilename() || "products.xlsx";
    const filePath = join(tempDir, filename);
    await download.saveAs(filePath);
    const fileBuffer = await readFile(filePath);
    console.log(`[products] downloaded ${filename} (${fileBuffer.length} bytes)`);

    // Vercel API로 업로드
    const form = new FormData();
    form.append("file", new Blob([fileBuffer]), filename);
    form.append("source", "worker-scrape");
    const r = await fetch(opts.uploadUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.uploadToken}` },
      body: form,
    });
    const body = await r.json().catch(() => ({}));
    return {
      status: r.ok ? "ok" : "error",
      filePath,
      fileSize: fileBuffer.length,
      uploadStatus: r.status,
      uploadResponse: body,
      error: r.ok ? undefined : `upload failed: ${r.status}`,
    };
  } catch (err) {
    console.error("[products] sync error:", err);
    return { status: "error", error: (err as Error).message };
  } finally {
    await browser?.close().catch(() => {});
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    running = false;
  }
}
