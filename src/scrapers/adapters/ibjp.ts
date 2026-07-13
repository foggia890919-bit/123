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

// 전문/급여 badges sometimes get concatenated with the product name
// (e.g. "전문급여플라그렐정(병)"). Strip leading badge prefixes.
function stripBadges(s: string): string {
  return s.replace(/^(전문|일반|급여|비급여)+/g, "").trim();
}

// cells 배열에서 단가/재고/제품명 추출 — searchByCode / searchByName 공용.
// `rest` 는 code 셀을 제외한 나머지 셀들 (code 가 없으면 전체 셀).
function extractIbjpItem(code: string, rest: string[], allCells: string[]): InventoryItem {
  const numericCells = rest.filter(c => /^[\d,]+$/.test(c.replace(/\s/g, "")));
  const [priceRaw, stockRaw] = numericCells;
  const priceStr = priceRaw?.replace(/[^\d]/g, "") ?? "";
  const stockStr = stockRaw?.replace(/[^\d]/g, "") ?? "";

  const nameCandidates = rest
    .filter(c => !/^(전문|일반|급여|비급여|담기|반품|이력|관심)$/.test(c) && !/^[\d,\s]+$/.test(c));

  const productName = stripBadges(nameCandidates[0] ?? "");
  const spec = nameCandidates[1] ?? null;
  const manufacturer = nameCandidates[2] ?? null;

  return {
    insuranceCode: code,
    productName,
    spec,
    manufacturer,
    unitPrice: priceStr ? Number(priceStr) : null,
    stock: stockStr ? Number(stockStr) : null,
    raw: { cells: allCells },
  };
}

// 검색창에 keyword 를 넣고 결과 테이블의 행(셀 배열 목록)을 돌려준다.
// searchByCode / searchByName 이 공유하는 SPA 검색 흐름.
async function ibjpSearch(page: Page, keyword: string, baseUrl: string): Promise<string[][]> {
  // 페이지 진입 직후만 SPA 렌더링 대기 — 같은 페이지에서 연속 검색은 짧게.
  const onOrderPage = await page.locator(SEL.searchInput).first().isVisible().catch(() => false);
  if (!onOrderPage) {
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(400);
    // /dist/comOrd is the integrated-order route observed after login.
    await page.goto(baseUrl + SEL.orderPath, { waitUntil: "commit", timeout: 30_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(400);
  }

  // Dismiss any dialog that may have appeared on page navigation
  await dismissQDialogs(page);

  const input = await waitAny(page, SEL.searchInput, 30_000);
  await input.click();
  await input.fill(keyword);  // type → fill (타이핑 지연 제거)

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
      { timeout: 5_000 }
    )
    .catch(() => {});
  await page.waitForTimeout(200);

  const rows = await page.locator(SEL.resultRows).all();
  const out: string[][] = [];
  for (const row of rows) {
    const cells = (await row.locator("td").allTextContents()).map(c => c.trim()).filter(Boolean);
    if (cells.length > 0) out.push(cells);
  }
  return out;
}

// 괄호 안 내용 제거 + 공백 제거 후 검색어를 포함하는지 비교하기 위한 정규화.
function normalizeForNameMatch(s: string): string {
  return s.replace(/\([^)]*\)/g, "").replace(/\s+/g, "");
}

async function dismissQDialogs(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const visible = await page.locator(".q-dialog__backdrop").first().isVisible({ timeout: 800 }).catch(() => false);
    if (!visible) break;
    // JS 직접 클릭 (Playwright 오버레이 감지 우회) + Escape 병행
    await page.evaluate(() => {
      (document.querySelector(".q-dialog__backdrop") as HTMLElement | null)?.click();
    }).catch(() => {});
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }
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
    await dismissQDialogs(page);

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
    const rows = await ibjpSearch(page, insuranceCode, this.baseUrl);
    const items: InventoryItem[] = [];

    for (const cells of rows) {
      // Only accept rows where the first cell is the insurance code itself.
      // This excludes the 제품정보 panel below the table, whose rows look
      // like ["보험코드", "643703630", ...].
      const code = cells[0];
      if (!/^\d{9,12}$/.test(code)) continue;

      items.push(extractIbjpItem(code, cells.slice(1), cells));
    }

    return items;
  },

  async searchByName(page: Page, productName: string): Promise<InventoryItem[]> {
    const rows = await ibjpSearch(page, productName, this.baseUrl);
    const items: InventoryItem[] = [];

    for (const cells of rows) {
      // 비급여 품목은 코드가 없거나 다른 형식일 수 있으니 완화:
      // 첫 셀이 코드 형식이면 insuranceCode 로, 아니면 "" 로 두고 파싱 계속.
      const first = cells[0];
      const hasCode = /^\d{9,12}$/.test(first);
      const code = hasCode ? first : "";
      const rest = hasCode ? cells.slice(1) : cells;
      items.push(extractIbjpItem(code, rest, cells));
    }

    // 검색어를 포함하는 품목만 반환 (괄호 안 내용/공백 무시).
    const needle = normalizeForNameMatch(productName);
    const filtered = items.filter(it => normalizeForNameMatch(it.productName).includes(needle));

    console.log(`[ibjp] name="${productName}" rows=${rows.length} items=${filtered.length}`);
    return filtered;
  },
};
