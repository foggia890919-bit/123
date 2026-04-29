"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const adapters_1 = require("./scrapers/adapters");
const env_1 = require("./scrapers/core/env");
const session_1 = require("./scrapers/core/session");
const scheduler_1 = require("./scrapers/core/scheduler");
const storage_1 = require("./scrapers/core/storage");
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "1mb" }));
const TOKEN = process.env.WORKER_TOKEN;
const PORT = Number(process.env.PORT ?? 3001);
function auth(req, res) {
    if (!TOKEN)
        return true;
    const header = req.headers.authorization;
    if (header !== `Bearer ${TOKEN}`) {
        res.status(401).json({ error: "unauthorized" });
        return false;
    }
    return true;
}
app.get("/health", (_req, res) => {
    res.json({ ok: true, sites: Object.keys(adapters_1.ALL_ADAPTERS) });
});
app.post("/scrape", async (req, res) => {
    if (!auth(req, res))
        return;
    const { codes, sites } = req.body;
    if (!Array.isArray(codes) || codes.length === 0) {
        res.status(400).json({ error: "codes (string[]) required" });
        return;
    }
    const validCodes = codes.filter((c) => typeof c === "string" && /^\d{9,12}$/.test(c));
    if (validCodes.length === 0) {
        res.status(400).json({ error: "no valid insurance codes (9-12 digits)" });
        return;
    }
    // Resolve which sites to scrape
    const enabledKeys = (0, env_1.enabledSiteKeys)();
    const requestedKeys = Array.isArray(sites) && sites.length > 0
        ? sites.filter((s) => enabledKeys.includes(s))
        : enabledKeys;
    if (requestedKeys.length === 0) {
        res.status(503).json({ error: "no sites configured — set SCRAPER_SITES env" });
        return;
    }
    let adapters;
    try {
        adapters = (0, adapters_1.resolveAdapters)(requestedKeys);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
        return;
    }
    const credentials = (0, env_1.loadCredentialsFromEnv)(requestedKeys);
    const session = new session_1.Session({ headless: true });
    try {
        await session.start();
        const scheduler = new scheduler_1.Scheduler({
            adapters,
            credentials,
            intervalMs: Number(process.env.SCRAPE_INTERVAL_MS ?? 1500),
            session,
        });
        const results = await scheduler.run(validCodes, "cross");
        // Persist to DB if DATABASE_URL is configured
        if (process.env.DATABASE_URL) {
            await (0, storage_1.saveResults)(results).catch((e) => console.error("[worker] DB save failed:", e));
        }
        res.json({ results, source: "live" });
    }
    catch (err) {
        console.error("[worker] scrape error:", err);
        res.status(500).json({ error: err.message });
    }
    finally {
        await session.stop().catch(() => { });
    }
});
app.listen(PORT, () => {
    console.log(`[worker] listening on :${PORT}`);
    console.log(`[worker] sites: ${(0, env_1.enabledSiteKeys)().join(", ") || "(none)"}`);
});
