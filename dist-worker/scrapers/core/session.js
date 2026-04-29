"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Session = void 0;
const playwright_1 = require("playwright");
const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
class Session {
    constructor(opts = {}) {
        this.sessions = new Map();
        this.reloginAfterMs = opts.reloginAfterMs ?? 20 * 60 * 1000;
        this.headless = opts.headless ?? true;
        this.userAgent = opts.userAgent ?? DEFAULT_UA;
    }
    async start() {
        this.browser = await playwright_1.chromium.launch({
            headless: this.headless,
            args: ["--disable-blink-features=AutomationControlled"],
        });
    }
    async stop() {
        for (const s of this.sessions.values()) {
            await s.ctx.close().catch(() => { });
        }
        this.sessions.clear();
        await this.browser?.close();
    }
    async getPage(adapter, creds) {
        if (!this.browser)
            throw new Error("Session not started");
        const existing = this.sessions.get(adapter.key);
        if (existing) {
            const stale = Date.now() - existing.lastLoginAt > this.reloginAfterMs;
            if (!stale) {
                try {
                    if (await adapter.isLoggedIn(existing.page))
                        return existing.page;
                }
                catch {
                    // fall through to relogin
                }
            }
            await existing.ctx.close().catch(() => { });
            this.sessions.delete(adapter.key);
        }
        const ctx = await this.browser.newContext({
            viewport: { width: 1440, height: 900 },
            userAgent: this.userAgent,
            locale: "ko-KR",
            timezoneId: "Asia/Seoul",
        });
        const page = await ctx.newPage();
        await adapter.login(page, creds);
        this.sessions.set(adapter.key, { ctx, page, lastLoginAt: Date.now() });
        return page;
    }
    async invalidate(key) {
        const existing = this.sessions.get(key);
        if (!existing)
            return;
        await existing.ctx.close().catch(() => { });
        this.sessions.delete(key);
    }
}
exports.Session = Session;
