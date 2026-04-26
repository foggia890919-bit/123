import type { Locator, Page } from "playwright";
import type { Credentials, InventoryItem, WholesaleAdapter } from "../core/types";

// /dist/login path + SPA bundling suggests Vue/React build. Selectors below
// assume client-rendered form — we wait for inputs to appear rather than
// relying on immediate DOM. Tighten after running `npm run scrape:inspect`.
const SEL = {
  idInput: [
    'input[name="id"]',
    'input[name="userId"]',
    'input[placeholder*="아이디"]',
    'input[placeholder*="ID"]',
    'input[type="text"]:not([readonly]):not([disabled])',
  ].join(", "),
  pwInput: [
    'input[name="pw"]',
    'input[name="password"]',
    'input[type="password"]',
  ].join(", "),
  loginBtn: [
    'button:has-text("로그인")',
    'a:has-text("로그인")',
    'input[type="submit"][value*="로그인"]',
    'button[type="submit"]',
  ].join(", "),
  orderPath: "/dist/comOrd",
  searchInput: [
    'input[placeholder*="품목명"]',
    'input[placeholder*="보험코드"]',
    'input[type="search"]',
    'input.search-input',
    'input[name="searchKeyword"]',
    'input[name="keyword"]',
  ].join(", "),
  searchBtn: [
    'button:has-text("검색")',
    'a:has-text("검색")',
    'button.btn-search',
    'button[type="submit"]:has-text("검색")',
  ].join(", "),
  resultRows: "table tbody tr, table tr:has(td)",
};

async function waitAny(page: Page, selector: string, timeout = 15_000): Promise<Locator> {
  await page.waitForSelector(selector, { timeout, state: "visible" });
  return page.locator(selector).first();
}

export const ibjp: WholesaleAdapter = {
  key: "ibjp",
  name: "백제약품",
  baseUrl: "https://ibjp.co.kr",
  loginUrl: "https://ibjp.co.kr/dist/login",

  async login(page: Page, creds: Credentials) {
    await page.goto(this.loginUrl, { waitUntil: "commit", timeout: 60_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    // SPA: wait for form to render
    const idInput = await waitAny(page, SEL.idInput);
    const pwInput = await waitAny(page, SEL.pwInput);

    await idInput.fill(creds.id);
    await pwInput.fill(creds.pw);

    const btn = page.locator(SEL.loginBtn).first();
    await Promise.all([
      page.waitForURL(u => !u.toString().includes("/login"), { timeout: 15_000 }).catch(() => {}),
      btn.click(),
    ]);

    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    if (page.url().includes("/login")) {
      // Some sites post via Enter instead; retry once with keyboard
      await pwInput.press("Enter");
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    }
    if (page.url().includes("/login")) {
      throw new Error("ibjp login failed — still on /login after submit");
    }
  },

  async isLoggedIn(page: Page) {
    return !page.url().includes("/login");
  },

  async searchByCode(page: Page, insuranceCode: string): Promise<InventoryItem[]> {
    // Make sure the SPA has finished rendering after login before we
    // probe for the input.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    let inputAlreadyVisible = await page.locator(SEL.searchInput).first().isVisible().catch(() => false);
    if (!inputAlreadyVisible) {
      // /dist/comOrd is the integrated-order route observed after login.
      await page.goto(this.baseUrl + SEL.orderPath, { waitUntil: "commit", timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      inputAlreadyVisible = await page.locator(SEL.searchInput).first().isVisible().catch(() => false);
    }

    const input = await waitAny(page, SEL.searchInput, 30_000);
    await input.click();
    await input.fill("");
    await input.type(insuranceCode, { delay: 30 });

    // Prefer clicking 검색 button over Enter — Enter behaviour varies by SPA.
    const btn = page.locator(SEL.searchBtn).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    // Result table is updated via AJAX, not navigation. Wait for either
    // a populated row or the "no results" text to appear.
    await page
      .waitForFunction(
        () => {
          const rows = document.querySelectorAll("table tbody tr");
          if (rows.length === 0) return false;
          for (const r of Array.from(rows)) {
            const tds = r.querySelectorAll("td");
            if (tds.length > 0) return true;
          }
          return false;
        },
        { timeout: 10_000 }
      )
      .catch(() => {});
    await page.waitForTimeout(800);

    const rows = await page.locator(SEL.resultRows).all();
    const items: InventoryItem[] = [];

    for (const row of rows) {
      const cells = (await row.locator("td").allTextContents()).map(c => c.trim()).filter(Boolean);
      if (cells.length === 0) continue;

      const code = cells.find(c => /^\d{9,12}$/.test(c));
      if (!code) continue;

      const numericCells = cells.filter(c => c !== code && /^[\d,]+$/.test(c.replace(/\s/g, "")));
      const [priceRaw, stockRaw] = numericCells;
      const priceStr = priceRaw?.replace(/[^\d]/g, "") ?? "";
      const stockStr = stockRaw?.replace(/[^\d]/g, "") ?? "";

      const nameCandidates = cells.filter(
        c => c !== code && !/^(전문|일반|급여|비급여)$/.test(c) && !/^[\d,\s]+$/.test(c)
      );
      const productName = nameCandidates[0] ?? "";
      const spec = nameCandidates[1] ?? null;
      const manufacturer = nameCandidates[2] ?? null;

      items.push({
        insuranceCode: code,
        productName,
        spec,
        manufacturer,
        unitPrice: priceStr ? Number(priceStr) : null,
        stock: stockStr ? Number(stockStr) : null,
        raw: { cells },
      });
    }

    return items;
  },
};
