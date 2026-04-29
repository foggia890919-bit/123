"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCredentialsFromEnv = loadCredentialsFromEnv;
exports.enabledSiteKeys = enabledSiteKeys;
function loadCredentialsFromEnv(siteKeys) {
    const out = {};
    for (const key of siteKeys) {
        const prefix = `SCRAPER_${key.toUpperCase()}_`;
        const id = process.env[`${prefix}ID`];
        const pw = process.env[`${prefix}PW`];
        if (!id || !pw)
            continue;
        out[key] = { id, pw };
    }
    return out;
}
function enabledSiteKeys() {
    const raw = process.env.SCRAPER_SITES;
    if (!raw || !raw.trim())
        return [];
    return raw.split(",").map(s => s.trim()).filter(Boolean);
}
