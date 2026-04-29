"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const playwright_1 = require("playwright");
const adapters_1 = require("./adapters");
const env_1 = require("./core/env");
// Debug harness: logs into one site, runs one search, dumps screenshots + HTML
// so we can tune selectors without guessing.
//
// Usage:
//   tsx src/scrapers/inspect.ts <siteKey> <insuranceCode>
//   e.g. tsx src/scrapers/inspect.ts ibjp 643703630
//
// Env:
//   INSPECT_HEADLESS=false    show browser window
//
// Output: debug/<siteKey>/<timestamp>/{login,loggedIn,search}.{png,html}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
async function dump(outDir, label, page) {
    await page.screenshot({ path: (0, node_path_1.resolve)(outDir, `${label}.png`), fullPage: true });
    const html = await page.content();
    await (0, promises_1.writeFile)((0, node_path_1.resolve)(outDir, `${label}.html`), html, "utf8");
    await (0, promises_1.writeFile)((0, node_path_1.resolve)(outDir, `${label}.url.txt`), page.url(), "utf8");
    console.log(`[dump] ${label} → ${outDir} (url=${page.url()})`);
}
async function main() {
    const [, , siteKey, code] = process.argv;
    if (!siteKey || !code) {
        console.error("usage: tsx src/scrapers/inspect.ts <siteKey> <insuranceCode>");
        process.exit(1);
    }
    const [adapter] = (0, adapters_1.resolveAdapters)([siteKey]);
    const creds = (0, env_1.loadCredentialsFromEnv)([siteKey])[siteKey];
    if (!creds)
        throw new Error(`Missing credentials for ${siteKey} in .env`);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = (0, node_path_1.resolve)(process.cwd(), "debug", siteKey, stamp);
    await (0, promises_1.mkdir)(outDir, { recursive: true });
    const headless = process.env.INSPECT_HEADLESS !== "false";
    const browser = await playwright_1.chromium.launch({
        headless,
        args: ["--disable-blink-features=AutomationControlled"],
    });
    const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent: UA,
        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
    });
    const page = await ctx.newPage();
    try {
        console.log(`[goto] ${adapter.loginUrl}`);
        await page.goto(adapter.loginUrl, { waitUntil: "commit", timeout: 60000 });
        await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => { });
        await page.waitForTimeout(1500);
        await dump(outDir, "01-login-page", page);
        try {
            await adapter.login(page, creds);
        }
        catch (err) {
            await dump(outDir, "02-after-login-FAILED", page);
            await (0, promises_1.writeFile)((0, node_path_1.resolve)(outDir, "error.txt"), `LOGIN FAILED:\n${err.stack ?? err}`, "utf8");
            throw err;
        }
        await page.waitForTimeout(1500);
        await dump(outDir, "02-after-login", page);
        // Enumerate every input on the page so we can match selectors offline
        // even if the search step fails.
        const inputs = await page.$$eval("input, textarea", els => els.map((el, i) => {
            const e = el;
            return {
                i,
                tag: e.tagName.toLowerCase(),
                type: e.type ?? null,
                name: e.name ?? null,
                id: e.id ?? null,
                placeholder: e.placeholder ?? null,
                className: e.className ?? null,
                visible: !!(e.offsetWidth || e.offsetHeight),
            };
        }));
        await (0, promises_1.writeFile)((0, node_path_1.resolve)(outDir, "page-inputs.json"), JSON.stringify(inputs, null, 2), "utf8");
        console.log(`[inputs] dumped ${inputs.length} input(s)`);
        // Tap into the page mid-search so we can see what the SPA looked like
        // at each phase — useful for diagnosing blank-page captures.
        page.on("framenavigated", f => {
            if (f === page.mainFrame())
                console.log(`[nav] ${f.url()}`);
        });
        let items = [];
        try {
            items = await adapter.searchByCode(page, code);
        }
        catch (err) {
            await page.waitForTimeout(500);
            await dump(outDir, "03-after-search-FAILED", page);
            await (0, promises_1.writeFile)((0, node_path_1.resolve)(outDir, "error.txt"), `SEARCH FAILED:\n${err.stack ?? err}`, "utf8");
            throw err;
        }
        await page.waitForTimeout(500);
        await dump(outDir, "03-after-search", page);
        await (0, promises_1.writeFile)((0, node_path_1.resolve)(outDir, "parsed.json"), JSON.stringify({ siteKey, code, items }, null, 2), "utf8");
        console.log(`[parsed] ${items.length} item(s):`);
        for (const i of items)
            console.log(" ", i);
    }
    finally {
        await ctx.close().catch(() => { });
        await browser.close().catch(() => { });
        console.log(`\ndebug output: ${outDir}`);
    }
}
main().catch(err => {
    console.error("[fatal]", err);
    process.exit(1);
});
