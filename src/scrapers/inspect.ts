import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { resolveAdapters } from "./adapters";
import { loadCredentialsFromEnv } from "./core/env";

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

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function dump(outDir: string, label: string, page: Page) {
  await page.screenshot({ path: resolve(outDir, `${label}.png`), fullPage: true });
  const html = await page.content();
  await writeFile(resolve(outDir, `${label}.html`), html, "utf8");
  await writeFile(resolve(outDir, `${label}.url.txt`), page.url(), "utf8");
  console.log(`[dump] ${label} → ${outDir} (url=${page.url()})`);
}

async function main() {
  const [, , siteKey, code] = process.argv;
  if (!siteKey || !code) {
    console.error("usage: tsx src/scrapers/inspect.ts <siteKey> <insuranceCode>");
    process.exit(1);
  }

  const [adapter] = resolveAdapters([siteKey]);
  const creds = loadCredentialsFromEnv([siteKey])[siteKey];
  if (!creds) throw new Error(`Missing credentials for ${siteKey} in .env`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(process.cwd(), "debug", siteKey, stamp);
  await mkdir(outDir, { recursive: true });

  const headless = process.env.INSPECT_HEADLESS !== "false";
  const browser = await chromium.launch({
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
    await page.goto(adapter.loginUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await dump(outDir, "01-login-page", page);

    await adapter.login(page, creds);
    await page.waitForTimeout(1500);
    await dump(outDir, "02-after-login", page);

    const items = await adapter.searchByCode(page, code);
    await page.waitForTimeout(500);
    await dump(outDir, "03-after-search", page);

    await writeFile(
      resolve(outDir, "parsed.json"),
      JSON.stringify({ siteKey, code, items }, null, 2),
      "utf8"
    );
    console.log(`[parsed] ${items.length} item(s):`);
    for (const i of items) console.log(" ", i);
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    console.log(`\ndebug output: ${outDir}`);
  }
}

main().catch(err => {
  console.error("[fatal]", err);
  process.exit(1);
});
