"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scheduler = void 0;
class Scheduler {
    constructor(opts) {
        this.opts = opts;
        this.lastCallAt = new Map();
        if (opts.adapters.length === 0)
            throw new Error("no adapters registered");
    }
    async run(codes, mode) {
        const results = [];
        const adapters = this.opts.adapters.filter(a => this.opts.credentials[a.key]);
        if (adapters.length === 0) {
            throw new Error("no adapters have credentials configured");
        }
        for (let i = 0; i < codes.length; i++) {
            const code = codes[i];
            if (mode === "round-robin") {
                const adapter = adapters[i % adapters.length];
                const r = await this.callOne(adapter, code);
                results.push(r);
                this.opts.onResult?.(r);
            }
            else {
                for (const adapter of adapters) {
                    const r = await this.callOne(adapter, code);
                    results.push(r);
                    this.opts.onResult?.(r);
                }
            }
        }
        return results;
    }
    async callOne(adapter, code) {
        await this.respectInterval(adapter.key);
        const start = Date.now();
        const creds = this.opts.credentials[adapter.key];
        try {
            const page = await this.opts.session.getPage(adapter, creds);
            const items = await adapter.searchByCode(page, code);
            return { siteKey: adapter.key, insuranceCode: code, items, durationMs: Date.now() - start };
        }
        catch (err) {
            await this.opts.session.invalidate(adapter.key);
            return {
                siteKey: adapter.key,
                insuranceCode: code,
                items: [],
                error: err.message,
                durationMs: Date.now() - start,
            };
        }
        finally {
            this.lastCallAt.set(adapter.key, Date.now());
        }
    }
    async respectInterval(key) {
        const last = this.lastCallAt.get(key) ?? 0;
        const wait = this.opts.intervalMs - (Date.now() - last);
        if (wait > 0)
            await new Promise(r => setTimeout(r, wait));
    }
}
exports.Scheduler = Scheduler;
