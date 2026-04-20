import type { Page } from "playwright";
import type { Credentials, InventoryItem, WholesaleAdapter } from "../core/types";

// Selectors are best-effort from visual inspection of the order page.
// Run PoC first, log raw cells, then tighten these if layout differs.
const SEL = {
  idInput: 'input[name="id"], input[name="userId"], input[type="text"]',
  pwInput: 'input[name="pw"], input[name="password"], input[type="password"]',
  loginBtn: 'button:has-text("로그인"), button[type="submit"]',
  orderUrl: "https://ibjp.co.kr/dist/order",
  searchInput: 'input[placeholder*="품목명"], input[placeholder*="보험코드"]',
  searchBtn: 'button:has-text("검색")',
  resultRows: "table tbody tr",
};

export const ibjp: WholesaleAdapter = {
  key: "ibjp",
  name: "백제약품",
  baseUrl: "https://ibjp.co.kr",
  loginUrl: "https://ibjp.co.kr/dist/login",

  async login(page: Page, creds: Credentials) {
    await page.goto(this.loginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator(SEL.idInput).first().fill(creds.id);
    await page.locator(SEL.pwInput).first().fill(creds.pw);
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {}),
      page.locator(SEL.loginBtn).first().click(),
    ]);
    await page.waitForTimeout(500);
    if (page.url().includes("/login")) {
      throw new Error("ibjp login failed (still on /login)");
    }
  },

  async isLoggedIn(page: Page) {
    return !page.url().includes("/login");
  },

  async searchByCode(page: Page, insuranceCode: string): Promise<InventoryItem[]> {
    if (!page.url().includes("/order")) {
      await page.goto(SEL.orderUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    }

    const input = page.locator(SEL.searchInput).first();
    await input.click();
    await input.fill("");
    await input.fill(insuranceCode);
    await page.keyboard.press("Enter");

    await page.waitForTimeout(800);

    const rows = await page.locator(SEL.resultRows).all();
    const items: InventoryItem[] = [];

    for (const row of rows) {
      const cells = (await row.locator("td").allTextContents()).map(c => c.trim()).filter(Boolean);
      if (cells.length === 0) continue;

      const code = cells.find(c => /^\d{9,12}$/.test(c));
      if (!code) continue;

      const numericIdx = cells.findIndex(c => /^[\d,]+$/.test(c.replace(/\s/g, "")) && c !== code);
      const priceStr = cells[numericIdx]?.replace(/[^\d]/g, "") ?? "";
      const stockStr = cells[numericIdx + 1]?.replace(/[^\d]/g, "") ?? "";

      const nameCandidates = cells.filter(c =>
        c !== code &&
        !/^(전문|일반|급여|비급여)$/.test(c) &&
        !/^[\d,\s]+$/.test(c)
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
