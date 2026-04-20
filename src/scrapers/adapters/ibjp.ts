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
  orderPath: "/dist/order",
  searchInput: [
    'input[placeholder*="품목명"]',
    'input[placeholder*="보험코드"]',
    'input[type="search"]',
  ].join(", "),
  searchBtn: 'button:has-text("검색")',
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
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
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
    if (!page.url().includes(SEL.orderPath)) {
      await page.goto(this.baseUrl + SEL.orderPath, { waitUntil: "domcontentloaded", timeout: 20_000 });
    }

    const input = await waitAny(page, SEL.searchInput);
    await input.click();
    await input.fill("");
    await input.fill(insuranceCode);
    await page.keyboard.press("Enter");

    // Wait for either rows to appear or "no result" text; fall back to timeout
    await page
      .waitForSelector(SEL.resultRows, { timeout: 8_000, state: "attached" })
      .catch(() => {});
    await page.waitForTimeout(600);

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
