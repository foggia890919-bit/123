import { writeFileSync } from "node:fs";
import type { Locator, Page } from "playwright";
import type { Credentials, InventoryItem, WholesaleAdapter } from "../core/types";

// 인천약품 (WOS — Wholesale Ordering System)
// ASP-classic backend; login form posts to a server-rendered page.
//
// Confirmed via screenshot:
//   주문 page (Order.asp) has a 보험코드 input + 조회 button.
//   Result table columns: KD코드 | 제조사 | 제품명 | 규격 | 구분 | 단가 | DC | 재고 | 수량 | 선택
const SEL = {
  // Login form input names are unknown until first run. The browser autofill
  // popup in the screenshot doesn't tell us the actual `name=` attribute, so
  // we list the most common ASP/WOS conventions and let Playwright pick one.
  idInput: [
    'input[name="mb_id"]',
    'input[name="user_id"]',
    'input[name="userid"]',
    'input[name="userId"]',
    'input[name="id"]',
    'input[name="loginId"]',
    'input[type="text"]:not([readonly]):not([disabled])',
  ].join(", "),
  pwInput: [
    'input[name="mb_password"]',
    'input[name="user_pw"]',
    'input[name="userpw"]',
    'input[name="userPw"]',
    'input[name="pw"]',
    'input[name="password"]',
    'input[type="password"]',
  ].join(", "),
  loginBtn: [
    'button:has-text("로그인")',
    'a:has-text("로그인")',
    'input[type="submit"][value*="로그인"]',
    'input[type="image"][alt*="로그인"]',
    'img[alt*="로그인"]',
    'button[type="submit"]',
  ].join(", "),
  // 보험코드 input on the order page. The label "보험코드" sits to its left.
  searchInput: [
    'input[name="hbcd"]',
    'input[name="bxcode"]',
    'input[name="hbCode"]',
    'input[name="insrCd"]',
    'input[name="searchInsuCode"]',
    'input[placeholder*="보험"]',
    // Position-based fallback: "보험코드" label followed by an input
    'label:has-text("보험코드") + input',
    'th:has-text("보험코드") + td input',
    'td:has-text("보험코드") + td input',
  ].join(", "),
  searchBtn: [
    'input[type="button"][value*="조회"]',
    'input[type="submit"][value*="조회"]',
    'button:has-text("조회")',
    'a:has-text("조회")',
    'img[alt*="조회"]',
  ].join(", "),
  // Order.asp's result table — exclude the 장바구니 sidebar table on the right.
  resultRows: 'table:has(th:has-text("KD코드")) tbody tr, table:has(th:has-text("KD코드")) tr:has(td)',
};

const ORDER_URL = "https://inchunpharm.com/Service/Order/Order.asp?l=login";

// Selectors tried when dismissing modals / notice popups after login.
const MODAL_CLOSERS = [
  'button[aria-label="Close"]',
  'button[aria-label="닫기"]',
  'button:has-text("닫기")',
  'button:has-text("X")',
  'button:has-text("✕")',
  '.modal-close',
  '.btn-close',
  '[data-dismiss="modal"]',
  '#popup_close',
  '.popup-close',
  'a:has-text("오늘 하루 보지 않기")',
  'button:has-text("오늘 하루 보지 않기")',
];

async function waitAny(page: Page, selector: string, timeout = 20_000): Promise<Locator> {
  await page.waitForSelector(selector, { timeout, state: "visible" });
  return page.locator(selector).first();
}

/** Dismiss any visible modal/notice popup — tries main frame and all iframes. */
async function closeModalsIfAny(page: Page) {
  // Main frame
  for (const sel of MODAL_CLOSERS) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 })) {
        await el.click({ timeout: 500 });
        console.warn(`[inchun] closed modal via ${sel}`);
        await page.waitForTimeout(300);
      }
    } catch { /* skip */ }
  }
  // Some sites embed notice popups inside iframes
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    for (const sel of MODAL_CLOSERS) {
      try {
        const el = frame.locator(sel).first();
        if (await el.isVisible({ timeout: 500 })) {
          await el.click({ timeout: 500 });
          console.warn(`[inchun] closed iframe modal via ${sel} (frame=${frame.url()})`);
          await page.waitForTimeout(300);
        }
      } catch { /* skip */ }
    }
  }
}

export const inchun: WholesaleAdapter = {
  key: "inchun",
  name: "인천약품",
  baseUrl: "https://inchunpharm.com",
  loginUrl: "https://inchunpharm.com/Homepage/contents/login/login.asp",

  async login(page: Page, creds: Credentials) {
    // Automatically dismiss native browser dialogs (alert / confirm / prompt)
    // that may appear during or after login (e.g. session-expired warnings).
    // Register once per page object — the handler is removed when the page closes.
    page.on("dialog", async (dialog) => {
      console.warn(`[inchun] dialog ${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss();
    });

    // Close any new window/tab that the login flow opens (e.g. notice popups).
    page.on("popup", async (popup) => {
      console.warn(`[inchun] popup opened: ${popup.url()}`);
      await popup.close();
    });

    await page.goto(this.loginUrl, { waitUntil: "commit", timeout: 60_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(800);

    const idInput = await waitAny(page, SEL.idInput);
    const pwInput = await waitAny(page, SEL.pwInput);
    await idInput.fill(creds.id);
    await pwInput.fill(creds.pw);

    const btn = page.locator(SEL.loginBtn).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
    } else {
      await pwInput.press("Enter");
    }
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(800);

    // Dismiss any modals/notice popups that appear right after login.
    await closeModalsIfAny(page);

    // Verify login success: must have left login.asp AND the id input must
    // have disappeared (double guard against soft-fail redirects).
    const stillOnLoginPage = /login\.asp/i.test(page.url());
    const idInputStillVisible = await page.locator(SEL.idInput).first().isVisible({ timeout: 1_000 }).catch(() => false);

    if (stillOnLoginPage || idInputStillVisible) {
      // Capture debug artefacts to /tmp so the operator can inspect offline.
      const stamp = Date.now();
      try {
        await page.screenshot({ path: `/tmp/inchun-login-fail-${stamp}.png`, fullPage: true });
        const html = await page.content();
        writeFileSync(`/tmp/inchun-fail-${stamp}.html`, html);
        console.warn(`[inchun] login-fail artefacts → /tmp/inchun-*-${stamp}.{png,html}`);
      } catch { /* non-fatal */ }
      throw new Error(
        `inchun login failed — ${stillOnLoginPage ? "still on login.asp" : "id input still visible"} after submit`
      );
    }
  },

  async isLoggedIn(page: Page) {
    if (/login\.asp/i.test(page.url())) return false;
    // Extra check: id input must not be visible (covers cases where ASP
    // returns a 200 on the login page without redirecting).
    const idVisible = await page.locator(SEL.idInput).first().isVisible({ timeout: 500 }).catch(() => false);
    return !idVisible;
  },

  async searchByCode(page: Page, insuranceCode: string): Promise<InventoryItem[]> {
    // Order.asp is the search/order page; nav there if not already.
    if (!/Order\.asp/i.test(page.url())) {
      await page.goto(ORDER_URL, { waitUntil: "commit", timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(800);
      // Dismiss any modals that appear when entering the order page.
      await closeModalsIfAny(page);
    }

    const input = await waitAny(page, SEL.searchInput, 20_000);
    await input.click();
    await input.fill("");
    await input.type(insuranceCode, { delay: 30 });

    const btn = page.locator(SEL.searchBtn).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    // Wait for the result table to populate (or for the "제품이 없습니다" message)
    await page
      .waitForFunction(
        () => {
          const tables = document.querySelectorAll("table");
          for (const t of Array.from(tables)) {
            const ths = t.querySelectorAll("th");
            const isResultTable = Array.from(ths).some(th => /KD코드/.test(th.textContent ?? ""));
            if (!isResultTable) continue;
            const rows = t.querySelectorAll("tbody tr, tr:has(td)");
            // Either populated rows OR the "제품이 없습니다" empty-state row
            return rows.length > 0;
          }
          return false;
        },
        { timeout: 10_000 }
      )
      .catch(() => {});
    await page.waitForTimeout(600);

    // Resolve column indices from header row to survive site layout changes.
    // Expected headers: KD코드 | 제조사 | 제품명 | 규격 | 구분 | 단가 | DC | 재고 | 수량 | 선택
    let colCode = 0, colManufacturer = 1, colProduct = 2, colSpec = 3, colPrice = 5, colStock = 7;
    const headerRow = page.locator('table:has(th:has-text("KD코드")) tr:has(th)').first();
    const headerCells = await headerRow.locator("th").allTextContents().catch(() => [] as string[]);
    if (headerCells.length >= 4) {
      const norm = (s: string) => s.trim().replace(/\s+/g, "");
      const idx = (label: string) => headerCells.findIndex(h => norm(h).includes(label));
      const iCode = idx("KD코드");
      const iMfr  = idx("제조사");
      const iProd = idx("제품명");
      const iSpec = idx("규격");
      const iPri  = idx("단가");
      const iStk  = idx("재고");
      if (iCode >= 0)  colCode         = iCode;
      if (iMfr  >= 0)  colManufacturer = iMfr;
      if (iProd >= 0)  colProduct      = iProd;
      if (iSpec >= 0)  colSpec         = iSpec;
      if (iPri  >= 0)  colPrice        = iPri;
      if (iStk  >= 0)  colStock        = iStk;
    }

    const minCols = Math.max(colCode, colManufacturer, colProduct, colSpec, colPrice, colStock) + 1;

    const rows = await page.locator(SEL.resultRows).all();
    const items: InventoryItem[] = [];

    for (const row of rows) {
      const cells = (await row.locator("td").allTextContents()).map(c => c.trim());
      if (cells.length < minCols) continue;

      // Skip empty-state row "제품이 없습니다."
      if (cells[0]?.includes("제품이 없습니다")) continue;

      const code = cells[colCode];
      if (!code || !/^\d{9,12}$/.test(code)) continue;

      const priceStr = (cells[colPrice] ?? "").replace(/[^\d]/g, "");
      const stockStr = (cells[colStock] ?? "").replace(/[^\d]/g, "");

      items.push({
        insuranceCode: code,
        productName: cells[colProduct] ?? "",
        spec: cells[colSpec] || null,
        manufacturer: cells[colManufacturer] || null,
        unitPrice: priceStr ? Number(priceStr) : null,
        stock: stockStr ? Number(stockStr) : null,
        raw: { cells },
      });
    }

    return items;
  },
};
