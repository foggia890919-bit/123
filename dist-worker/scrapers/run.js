"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const adapters_1 = require("./adapters");
const env_1 = require("./core/env");
const scheduler_1 = require("./core/scheduler");
const session_1 = require("./core/session");
const storage_1 = require("./core/storage");
const loader_1 = require("./codes/loader");
function parseArgs() {
    const mode = (process.argv[2] ?? "poc");
    if (!["poc", "frequent", "full"].includes(mode)) {
        throw new Error(`Invalid mode: ${mode}. Use poc | frequent | full`);
    }
    const distribution = (process.env.SCRAPE_DISTRIBUTION ?? "round-robin");
    const intervalMs = Number(process.env.SCRAPE_INTERVAL_MS ?? 2000);
    const limit = process.env.SCRAPE_LIMIT ? Number(process.env.SCRAPE_LIMIT) : undefined;
    return { mode, distribution, intervalMs, limit };
}
async function loadCodes(mode) {
    if (mode === "poc")
        return (0, loader_1.loadPocCodes)();
    if (mode === "frequent")
        return (0, loader_1.loadFrequentCodes)(5000);
    return (0, loader_1.loadCodesFromDB)();
}
async function main() {
    const args = parseArgs();
    const keys = (0, env_1.enabledSiteKeys)();
    if (keys.length === 0) {
        throw new Error("SCRAPER_SITES env is empty. Set e.g. SCRAPER_SITES=ibjp");
    }
    const adapters = (0, adapters_1.resolveAdapters)(keys);
    const credentials = (0, env_1.loadCredentialsFromEnv)(keys);
    const missing = keys.filter(k => !credentials[k]);
    if (missing.length) {
        console.warn(`[warn] missing credentials for: ${missing.join(", ")} — these sites will be skipped`);
    }
    const allCodes = await loadCodes(args.mode);
    const codes = args.limit ? allCodes.slice(0, args.limit) : allCodes;
    console.log(`[info] mode=${args.mode} sites=${keys.join(",")} codes=${codes.length} interval=${args.intervalMs}ms distribution=${args.distribution}`);
    const useDb = !!process.env.DATABASE_URL;
    console.log(`[info] DB save: ${useDb ? "ON" : "OFF"} (CSV save is always on)`);
    const jobIds = {};
    if (useDb) {
        for (const a of adapters)
            await (0, storage_1.ensureSite)(a);
        for (const a of adapters.filter(a => credentials[a.key])) {
            jobIds[a.key] = await (0, storage_1.startJob)(a.key, args.mode, codes.length);
        }
    }
    const perSite = {};
    const session = new session_1.Session({ headless: true });
    await session.start();
    const results = [];
    try {
        const scheduler = new scheduler_1.Scheduler({
            adapters,
            credentials,
            intervalMs: args.intervalMs,
            session,
            onResult: r => {
                var _a;
                perSite[_a = r.siteKey] ?? (perSite[_a] = { done: 0, failed: 0 });
                if (r.error)
                    perSite[r.siteKey].failed += 1;
                else
                    perSite[r.siteKey].done += 1;
                const stats = perSite[r.siteKey];
                const total = stats.done + stats.failed;
                // Per-code progress for small runs (<100); summary every 25 for large.
                const verbose = codes.length < 100;
                if (verbose || total % 25 === 0) {
                    const status = r.error ? `ERR ${r.error}` : `${r.items.length} item(s)`;
                    console.log(`[${r.siteKey} ${total}/${codes.length}] ${r.insuranceCode} → ${status}`);
                }
            },
        });
        const out = await scheduler.run(codes, args.distribution);
        results.push(...out);
        const xlsxPath = await (0, storage_1.saveResultsToXlsx)(results);
        console.log(`[xlsx] saved -> ${xlsxPath}`);
        const csvPath = await (0, storage_1.saveResultsToCsv)(results);
        console.log(`[csv]  saved -> ${csvPath}`);
        if (useDb) {
            const saved = await (0, storage_1.saveResults)(results);
            console.log(`[db]  saved ${saved} rows`);
        }
        console.log(`[done] scraped=${results.length} errors=${results.filter(r => r.error).length}`);
    }
    finally {
        if (useDb) {
            for (const [key, stats] of Object.entries(perSite)) {
                if (jobIds[key])
                    await (0, storage_1.finishJob)(jobIds[key], stats).catch(() => { });
            }
        }
        await session.stop();
    }
}
main().catch(err => {
    console.error("[fatal]", err);
    process.exit(1);
});
