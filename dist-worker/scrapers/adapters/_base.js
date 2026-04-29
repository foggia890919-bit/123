"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeGenericAdapter = makeGenericAdapter;
const DEFAULT_SEL = {
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
async function waitAny(page, selector, timeout = 20000) {
    await page.waitForSelector(selector, { timeout, state: "visible" });
    return page.locator(selector).first();
}
function makeGenericAdapter(cfg) {
    const SEL = { ...DEFAULT_SEL, ...(cfg.selectors ?? {}) };
    return {
        key: cfg.key,
        name: cfg.name,
        baseUrl: cfg.baseUrl,
        loginUrl: cfg.loginUrl,
        async login(page, creds) {
            await page.goto(cfg.loginUrl, { waitUntil: "commit", timeout: 60000 });
            await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => { });
            await page.waitForTimeout(1500);
            // Some sites have an intro page; click the login link to expose the form
            const hasIdInput = await page.locator(SEL.idInput).first().isVisible().catch(() => false);
            if (!hasIdInput) {
                const linkSel = cfg.clickToOpenLoginLink ?? 'a:has-text("로그인"), button:has-text("로그인")';
                const loginLink = page.locator(linkSel).first();
                if (await loginLink.isVisible().catch(() => false)) {
                    await loginLink.click().catch(() => { });
                    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => { });
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
            }
            else {
                await pwInput.press("Enter");
            }
            await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => { });
        },
        async isLoggedIn(page) {
            const pw = await page.locator(SEL.pwInput).first().isVisible().catch(() => false);
            return !pw;
        },
        async searchByCode(page, insuranceCode) {
            if (cfg.searchPath) {
                const cur = page.url();
                if (!cur.includes(cfg.searchPath)) {
                    await page.goto(cfg.baseUrl + cfg.searchPath, { waitUntil: "commit", timeout: 30000 });
                    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => { });
                    await page.waitForTimeout(1500);
                }
            }
            const input = await waitAny(page, SEL.searchInput, 30000);
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
            await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => { });
            await page.waitForTimeout(800);
            const rows = await page.locator(SEL.resultRows).all();
            const items = [];
            for (const row of rows) {
                const cells = (await row.locator("td").allTextContents()).map(c => c.trim()).filter(Boolean);
                if (cells.length === 0)
                    continue;
                const code = cells[0];
                if (!/^\d{9,12}$/.test(code))
                    continue;
                const numericCells = cells
                    .slice(1)
                    .filter(c => /^[\d,]+$/.test(c.replace(/\s/g, "")));
                const [priceRaw, stockRaw] = numericCells;
                const priceStr = priceRaw?.replace(/[^\d]/g, "") ?? "";
                const stockStr = stockRaw?.replace(/[^\d]/g, "") ?? "";
                const nameCandidates = cells
                    .slice(1)
                    .filter(c => !/^(전문|일반|급여|비급여|담기|반품|이력|관심)$/.test(c) && !/^[\d,\s]+$/.test(c));
                const stripBadges = (s) => s.replace(/^(전문|일반|급여|비급여)+/g, "").trim();
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
