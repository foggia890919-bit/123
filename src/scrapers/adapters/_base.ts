import type { Locator, Page } from "playwright";
import type { Credentials, InventoryItem, WholesaleAdapter } from "../core/types";

// Generic adapter factory used by sites whose UI patterns are unknown
// until the first inspect run. Default selectors cover the most common
// Korean wholesale-portal conventions (jQuery/Spring-style forms).
//
// Once you've run inspect against a real site, override SEL fields per
// adapter rather than rewriting the whole flow.

export interface GenericAdapterConfig {
  key: string;
  name: string;
  baseUrl: string;
  loginUrl: string;
  // Optional selector overrides
  selectors?: Partial<GenericSelectors>;
  // If the landing page isn't the login form, click this first
  clickToOpenLoginLink?: string;
  // Custom post-login URL/path to navigate to before search
  searchPath?: string;
}

export interface GenericSelectors {
  idInput: string;
  pwInput: string;
  loginBtn: string;
  searchInput: string;
  searchBtn: string;
  resultRows: string;
}

const DEFAULT_SEL: GenericSelectors = {
  idInput: [
    'input[name="userId"]',
    'input[name="id"]',
    'input[name="loginId"]',
    'input[name="memberId"]',
    'input[name="mb_id"]',
    'input[placeholder*="아이디"]',
    'input[type="text"]:not([readonly])',
  ].join(", "),
  pwInput: [
    'input[name="userPwd"]',
    'input[name="pwd"]',
    'input[name="password"]',
    'input[name="memberPwd"]',
    'input[name="mb_password"]',
    'input[type="password"]',
  ].join(", "),
  loginBtn: [
    'button:has-text("로그인")',
    'a:has-text("로그인")',
    'input[type="submit"][value*="로그인"]',
    'button[type="submit"]',
    'input[type="image"][alt*="로그인"]',
  ].join(", "),
  searchInput: [
    'input[name="searchKeyword"]',
    'input[name="keyword"]',
    'input[name="searchWord"]',
    'input[placeholder*="보험"]',
    'input[placeholder*="품목"]',
    'input[placeholder*="검색"]',
    'input[type="search"]',
  ].join(", "),
  searchBtn: [
    'button:has-text("검색")',
    'a:has-text("검색")',
    'input[type="submit"][value*="검색"]',
    'button.btn-search',
  ].join(", "),
  resultRows: "table tbody tr, table tr:has(td)",
};

async function waitAny(page: Page, selector: string, timeout = 20_000): Promise<Locator> {
  await page.waitForSelector(selector, { timeout, state: "visible" });
  return page.locator(selector).first();
}

export function makeGenericAdapter(cfg: GenericAdapterConfig): WholesaleAdapter {
  const SEL: GenericSelectors = { ...DEFAULT_SEL, ...(cfg.selectors ?? {}) };

  return {
    key: cfg.key,
    name: cfg.name,
    baseUrl: cfg.baseUrl,
    loginUrl: cfg.loginUrl,

    async login(page: Page, creds: Credentials) {
      await page.goto(cfg.loginUrl, { waitUntil: "commit", timeout: 60_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1500);

      // Some sites have an intro page; click the login link to expose the form
      const hasIdInput = await page.locator(SEL.idInput).first().isVisible().catch(() => false);
      if (!hasIdInput) {
        const linkSel =
          cfg.clickToOpenLoginLink ?? 'a:has-text("로그인"), button:has-text("로그인")';
        const loginLink = page.locator(linkSel).first();
        if (await loginLink.isVisible().catch(() => false)) {
          await loginLink.click().catch(() => {});
          await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
          await page.waitForTimeout(1500);
        }
      }

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
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    },

    async isLoggedIn(page: Page) {
      const pw = await page.locator(SEL.pwInput).first().isVisible().catch(() => false);
      return !pw;
    },

    async searchByCode(page: Page, insuranceCode: string): Promise<InventoryItem[]> {
      if (cfg.searchPath) {
        const cur = page.url();
        if (!cur.includes(cfg.searchPath)) {
          await page.goto(cfg.baseUrl + cfg.searchPath, { waitUntil: "commit", timeout: 30_000 });
          await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
          await page.waitForTimeout(1500);
        }
      }

      const input = await waitAny(page, SEL.searchInput, 30_000);
      await input.click();
      await input.fill("");
      await input.type(insuranceCode, { delay: 30 });

      const btn = page.locator(SEL.searchBtn).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
      } else {
        await page.keyboard.press("Enter");
      }
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(800);

      const rows = await page.locator(SEL.resultRows).all();
      const items: InventoryItem[] = [];
      for (const row of rows) {
        const cells = (await row.locator("td").allTextContents()).map(c => c.trim()).filter(Boolean);
        if (cells.length === 0) continue;
        const code = cells[0];
        if (!/^\d{9,12}$/.test(code)) continue;

        const numericCells = cells
          .slice(1)
          .filter(c => /^[\d,]+$/.test(c.replace(/\s/g, "")));
        const [priceRaw, stockRaw] = numericCells;
        const priceStr = priceRaw?.replace(/[^\d]/g, "") ?? "";
        const stockStr = stockRaw?.replace(/[^\d]/g, "") ?? "";
        const nameCandidates = cells
          .slice(1)
          .filter(
            c => !/^(전문|일반|급여|비급여|담기|반품|이력|관심)$/.test(c) && !/^[\d,\s]+$/.test(c)
          );
        const stripBadges = (s: string) => s.replace(/^(전문|일반|급여|비급여)+/g, "").trim();

        items.push({
          insuranceCode: code,
          productName: stripBadges(nameCandidates[0] ?? ""),
          spec: nameCandidates[1] ?? null,
          manufacturer: nameCandidates[2] ?? null,
          unitPrice: priceStr ? Number(priceStr) : null,
          stock: stockStr ? Number(stockStr) : null,
          raw: { cells },
        });
      }
      return items;
    },
  };
}
