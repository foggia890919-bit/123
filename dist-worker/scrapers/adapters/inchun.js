"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inchun = void 0;
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
async function waitAny(page, selector, timeout = 20000) {
    await page.waitForSelector(selector, { timeout, state: "visible" });
    return page.locator(selector).first();
}
exports.inchun = {
    key: "inchun",
    name: "인천약품",
    baseUrl: "https://inchunpharm.com",
    loginUrl: "https://inchunpharm.com/Homepage/contents/login/login.asp",
    async login(page, creds) {
        await page.goto(this.loginUrl, { waitUntil: "commit", timeout: 60000 });
        await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => { });
        await page.waitForTimeout(800);
        const idInput = await waitAny(page, SEL.idInput);
        const pwInput = await waitAny(page, SEL.pwInput);
        await idInput.fill(creds.id);
        await pwInput.fill(creds.pw);
        const btn = page.locator(SEL.loginBtn).first();
        if (await btn.isVisible().catch(() => false)) {
            await btn.click();
        }
        else {
            await pwInput.press("Enter");
        }
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => { });
        await page.waitForTimeout(800);
        // After login, ASP usually redirects to /Service/... — verify we're not
        // still on the login page.
        if (/login\.asp/i.test(page.url())) {
            throw new Error("inchun login failed — still on login.asp after submit");
        }
    },
    async isLoggedIn(page) {
        return !/login\.asp/i.test(page.url());
    },
    async searchByCode(page, insuranceCode) {
        // Order.asp is the search/order page; nav there if not already.
        if (!/Order\.asp/i.test(page.url())) {
            await page.goto(ORDER_URL, { waitUntil: "commit", timeout: 30000 });
            await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => { });
            await page.waitForTimeout(800);
        }
        const input = await waitAny(page, SEL.searchInput, 20000);
        await input.click();
        await input.fill("");
        await input.type(insuranceCode, { delay: 30 });
        const btn = page.locator(SEL.searchBtn).first();
        if (await btn.isVisible().catch(() => false)) {
            await btn.click();
        }
        else {
            await page.keyboard.press("Enter");
        }
        // Wait for the result table to populate (or for the "제품이 없습니다" message)
        await page
            .waitForFunction(() => {
            const tables = document.querySelectorAll("table");
            for (const t of Array.from(tables)) {
                const ths = t.querySelectorAll("th");
                const isResultTable = Array.from(ths).some(th => /KD코드/.test(th.textContent ?? ""));
                if (!isResultTable)
                    continue;
                const rows = t.querySelectorAll("tbody tr, tr:has(td)");
                // Either populated rows OR the "제품이 없습니다" empty-state row
                return rows.length > 0;
            }
            return false;
        }, { timeout: 10000 })
            .catch(() => { });
        await page.waitForTimeout(600);
        const rows = await page.locator(SEL.resultRows).all();
        const items = [];
        for (const row of rows) {
            const cells = (await row.locator("td").allTextContents()).map(c => c.trim());
            if (cells.length < 8)
                continue;
            // Skip empty-state row "제품이 없습니다."
            if (cells[0]?.includes("제품이 없습니다"))
                continue;
            // Confirmed column order from screenshot:
            //   [0] KD코드  [1] 제조사  [2] 제품명  [3] 규격  [4] 구분
            //   [5] 단가    [6] DC      [7] 재고    [8] 수량  [9] 선택
            const code = cells[0];
            if (!/^\d{9,12}$/.test(code))
                continue;
            const priceStr = (cells[5] ?? "").replace(/[^\d]/g, "");
            const stockStr = (cells[7] ?? "").replace(/[^\d]/g, "");
            items.push({
                insuranceCode: code,
                productName: cells[2] ?? "",
                spec: cells[3] || null,
                manufacturer: cells[1] || null,
                unitPrice: priceStr ? Number(priceStr) : null,
                stock: stockStr ? Number(stockStr) : null,
                raw: { cells },
            });
        }
        return items;
    },
};
