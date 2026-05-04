// 이팜스 상품 마스터 자동 동기화 — 페이지별 크롤링 방식 (v2).
//
// 변경 이유:
//   v1은 "전체엑셀다운" 버튼 클릭 → 거대한 xlsx 다운로드 방식이었으나
//   - 이팜스 서버가 너무 무거워 다운로드 자체가 5~30분 + 자주 실패
//   - 거대한 파일(수십 MB)을 worker→Vercel 업로드하는 것도 비효율
//   - 첫 로그인 시 "배송일정 안내" 팝업이 떠 페이지 로딩 타임아웃 발생
//
// v2 설계:
//   - /order/order_search 직접 이동 (확정 URL)
//   - 팝업 자동 닫기
//   - 페이지별로 테이블 row 파싱 → 곧바로 DB upsert
//   - 다음 버튼(>) 누르며 1페이지부터 끝까지 순회
//   - 중간 끊겨도 priceCode 기준 upsert라 재시작 가능

import { chromium, type Browser, type Page } from "playwright";
import { Pool } from "pg";
import { login } from "./adapter.ts";
import {
  decryptPw,
  startProductSyncLog,
  updateProductSyncLogProgress,
  finishProductSyncLog,
  upsertProducts,
  type ProductRow,
} from "./db.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://yk.ep45.co.kr";
const LIST_URL = `${BASE}/order/order_search`;
const PER_PAGE_DELAY_MS = Number(process.env.EPHARMS_PRODUCT_PAGE_DELAY_MS ?? 800);
const MAX_PAGES = Number(process.env.EPHARMS_PRODUCT_MAX_PAGES ?? 1000); // 안전상한

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
       FROM "EpharmsAccount" WHERE "active" = true AND "isMaster" = true LIMIT 1`
  );
  if (rows.length > 0) return rows[0];
  const { rows: fallback } = await getPool().query<MasterAccount>(
    `SELECT "id","bizNumber","clientName","loginId","loginPwEnc"
       FROM "EpharmsAccount" WHERE "active" = true ORDER BY "createdAt" ASC LIMIT 1`
  );
  return fallback[0] ?? null;
}

/** 첫 로그인 시 뜨는 "배송일정 안내" 팝업 자동 닫기. */
async function dismissNoticePopup(page: Page): Promise<void> {
  // "오늘 하루 열지 않기" 체크 후 닫기 — 다음 페이지부터는 안 뜸
  try {
    const checkbox = page.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await checkbox.check({ force: true }).catch(() => {});
    }
    const closeBtn = page.locator(
      'button:has-text("닫기"), a:has-text("닫기"), button:has-text("확인")'
    ).first();
    if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeBtn.click().catch(() => {});
    }
  } catch { /* 팝업 없으면 무시 */ }
  await page.waitForTimeout(300);
}

/** 현재 페이지의 상품 테이블 행을 ProductRow[]로 파싱. */
async function parseCurrentPage(page: Page): Promise<ProductRow[]> {
  // 헤더 텍스트 기반으로 컬럼 인덱스 찾기 (캡쳐 컬럼: 제약사 | 상품명 | 규격 | 기준단가코드 | 단가 | 재고 | 주문수량)
  return await page.evaluate(() => {
    const out: Array<{
      priceCode: string;
      productName: string;
      manufacturer: string;
      spec: string | null;
      basePrice: number;
    }> = [];

    // 헤더가 있는 테이블만 선택
    const tables = Array.from(document.querySelectorAll("table"));
    const target = tables.find((t) => {
      const headers = Array.from(t.querySelectorAll("th")).map((th) => th.textContent?.trim() ?? "");
      return headers.includes("상품명") && headers.includes("기준단가코드");
    });
    if (!target) return out;

    const headerRow = target.querySelector("thead tr") ?? target.querySelector("tr");
    if (!headerRow) return out;
    const headers = Array.from(headerRow.querySelectorAll("th, td"))
      .map((c) => (c.textContent ?? "").trim());
    // 정확 일치 우선 — "단가" 가 "기준단가코드"에 먼저 매칭되는 것 방지
    const idx = (label: string): number => {
      const exact = headers.findIndex((h) => h === label);
      if (exact >= 0) return exact;
      return headers.findIndex((h) => h.includes(label));
    };

    const cManu = idx("제약사");
    const cName = idx("상품명");
    const cSpec = idx("규격");
    const cCode = idx("기준단가코드");
    const cPrice = idx("단가");
    if (cName < 0 || cCode < 0) return out;

    const bodyRows = Array.from(target.querySelectorAll("tbody tr"));
    for (const tr of bodyRows) {
      // Mustache 템플릿 행 ({{...}}) 또는 hidden 행은 스킵
      if ((tr as HTMLElement).style?.display === "none") continue;
      const rowText = (tr.textContent ?? "");
      if (rowText.includes("{{") || rowText.includes("}}")) continue;

      const cells = Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent ?? "").trim());
      if (cells.length === 0) continue;
      const priceCode = (cells[cCode] ?? "").replace(/\s+/g, "");
      const productName = cells[cName] ?? "";
      // 진짜 상품 행만 통과: 코드는 9자리 이상의 숫자/영문 포함 + 상품명이 mustache가 아님
      if (!priceCode || !productName) continue;
      if (priceCode.length < 6) continue;
      if (productName.startsWith("{{") || priceCode.startsWith("{{")) continue;

      const manufacturer = cManu >= 0 ? (cells[cManu] ?? "") : "";
      const spec = cSpec >= 0 ? cells[cSpec] : null;
      const priceText = cPrice >= 0 ? cells[cPrice] : "";
      const basePrice = Number((priceText || "0").replace(/[^\d.-]/g, "")) || 0;

      out.push({
        priceCode,
        productName,
        manufacturer,
        spec: spec || null,
        basePrice,
      });
    }
    return out;
  });
}

/** 페이지가 AJAX로 실제 데이터 채울 때까지 대기. 템플릿/placeholder만 있으면 false. */
async function waitForRealRows(page: Page, timeoutMs = 20_000): Promise<boolean> {
  return await page.waitForFunction(
    () => {
      const rows = document.querySelectorAll("tbody tr");
      let realCount = 0;
      for (const row of Array.from(rows)) {
        const text = (row.textContent ?? "");
        if (text.includes("{{") || text.length < 10) continue;
        if ((row as HTMLElement).style?.display === "none") continue;
        realCount++;
        if (realCount >= 3) return true; // 최소 3개 실제 행 확인되면 OK
      }
      return false;
    },
    undefined,
    { timeout: timeoutMs }
  ).then(() => true).catch(() => false);
}

/**
 * 페이지 N으로 이동. 페이지네이션:
 *   <a class=" on " href="#pager-item1">1</a>
 *   <a href="#pager-item2">2</a> ... <a href="#pager-item10">10</a>
 *   <a href="#pager-item11"><i class="fa fa-angle-right"></i></a>  ← ">" (다음 그룹)
 *
 * 전략:
 *   1. href 또는 텍스트로 직접 N 링크 찾기 → 있으면 클릭
 *   2. 없으면 ">" 클릭으로 다음 그룹 이동 → 재시도
 *   3. ">" 도 없거나 disabled면 종료
 */
async function goToPage(page: Page, n: number): Promise<boolean> {
  const findPageLink = () =>
    page.locator(`a[href="#pager-item${n}"]:not(:has(i))`).first();

  for (let attempt = 0; attempt < 3; attempt++) {
    const link = findPageLink();
    const visible = await link.isVisible().catch(() => false);

    if (visible) {
      // 이미 active면 클릭 불필요
      const isActive = await page
        .locator(`a[href="#pager-item${n}"].on`)
        .count().then((c) => c > 0).catch(() => false);
      if (isActive) return true;

      const firstRowBefore = await page
        .locator("tbody tr td").first().textContent().catch(() => "");
      await link.click();
      // 테이블 갱신 대기 — 첫 행 텍스트가 바뀌거나, 해당 페이지 링크가 .on 으로
      await page.waitForFunction(
        (args) => {
          const onLink = document.querySelector(`a[href="${args.href}"].on`);
          if (onLink) return true;
          const td = document.querySelector("tbody tr td");
          return td && (td.textContent ?? "").trim() !== args.prev;
        },
        { href: `#pager-item${n}`, prev: firstRowBefore ?? "" },
        { timeout: 20_000 }
      ).catch(() => {});
      await page.waitForTimeout(PER_PAGE_DELAY_MS);
      return true;
    }

    // 보이지 않음 → 다음 그룹으로 advance
    const nextArrow = page.locator('a:has(i.fa-angle-right)').first();
    const arrowExists = await nextArrow.count().then((c) => c > 0);
    if (!arrowExists) return false;

    const arrowDisabled = await nextArrow
      .evaluate((el) => {
        const a = el as HTMLAnchorElement;
        return a.classList.contains("disabled") || a.classList.contains("off");
      })
      .catch(() => false);
    if (arrowDisabled) return false;

    await nextArrow.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  return false;
}

export interface ProductSyncResult {
  status: "ok" | "error";
  pagesScraped: number;
  totalRows: number;
  inserted: number;
  updated: number;
  error?: string;
}

export async function syncProductMaster(opts: { triggeredBy?: string } = {}): Promise<ProductSyncResult> {
  if (running) throw new Error("product sync already running");
  running = true;

  const logId = await startProductSyncLog(opts.triggeredBy ?? null);
  let browser: Browser | undefined;
  let totalRows = 0, totalInserted = 0, totalUpdated = 0, pagesScraped = 0;

  try {
    const acc = await loadMasterAccount();
    if (!acc) throw new Error("활성화된 ePharms 마스터 계정이 없습니다.");
    console.log(`[products] master: ${acc.clientName} (${acc.bizNumber})`);

    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: UA,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });
    // tsx/esbuild가 page.evaluate 콜백에 __name 헬퍼 호출을 삽입하는데
    // 브라우저 컨텍스트에는 그 함수가 없어서 ReferenceError 발생.
    // 페이지 로드 직전에 stub을 주입해서 우회.
    await ctx.addInitScript(() => {
      const g = globalThis as unknown as { __name?: (fn: unknown) => unknown };
      if (typeof g.__name === "undefined") g.__name = (fn) => fn;
    });
    const page = await ctx.newPage();

    // 로그인
    await login(page, { loginId: acc.loginId, loginPw: decryptPw(acc.loginPwEnc) });
    console.log("[products] logged in");

    // 상품 검색 페이지로 이동 — load 대신 domcontentloaded만 기다리고 popup 처리
    await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);
    await dismissNoticePopup(page);
    console.log(`[products] landed on ${LIST_URL}`);

    // AJAX로 실제 상품 데이터가 로드될 때까지 대기 (mustache 템플릿만 있으면 false)
    const hasData = await waitForRealRows(page, 30_000);
    if (!hasData) {
      throw new Error("페이지 로드 후 30초 안에 실제 상품 행이 안 보임 — 로그인/네트워크 문제 가능성");
    }
    console.log("[products] real data rows detected — starting scrape");

    // 첫 페이지(1)는 이미 로드된 상태 — 바로 파싱부터 시작
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      // 페이지 1은 이동 불필요 (이미 로드됨), 2 이상은 클릭 이동 + 데이터 대기
      if (pageNum > 1) {
        const ok = await goToPage(page, pageNum);
        if (!ok) {
          console.log(`[products] page ${pageNum} not reachable — done`);
          break;
        }
        // 새 페이지 데이터 로드 대기
        await waitForRealRows(page, 15_000);
      }

      const rows = await parseCurrentPage(page);
      if (rows.length === 0 && pageNum === 1) {
        throw new Error("첫 페이지에서 상품 0건 — 셀렉터 또는 로그인 상태 확인 필요");
      }
      if (rows.length === 0) {
        console.log(`[products] page ${pageNum} empty — assuming end`);
        break;
      }

      const { inserted, updated } = await upsertProducts(rows);
      totalRows += rows.length;
      totalInserted += inserted;
      totalUpdated += updated;
      pagesScraped = pageNum;

      console.log(
        `[products] page ${pageNum}: ${rows.length} rows (ins=${inserted}/upd=${updated}) — total ${totalRows}`
      );

      if (pageNum % 5 === 0) {
        await updateProductSyncLogProgress(logId, totalRows, totalInserted, totalUpdated);
      }
    }

    await finishProductSyncLog(logId, {
      status: "ok",
      rowsTotal: totalRows,
      rowsInserted: totalInserted,
      rowsUpdated: totalUpdated,
    });
    console.log(`[products] DONE — pages=${pagesScraped} rows=${totalRows} ins=${totalInserted} upd=${totalUpdated}`);
    return { status: "ok", pagesScraped, totalRows, inserted: totalInserted, updated: totalUpdated };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error("[products] sync error:", msg);
    await finishProductSyncLog(logId, {
      status: "error",
      rowsTotal: totalRows,
      rowsInserted: totalInserted,
      rowsUpdated: totalUpdated,
      error: msg,
    });
    return { status: "error", pagesScraped, totalRows, inserted: totalInserted, updated: totalUpdated, error: msg };
  } finally {
    await browser?.close().catch(() => {});
    running = false;
  }
}
