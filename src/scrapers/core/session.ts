import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { Credentials, WholesaleAdapter } from "./types";

interface SiteSession {
  ctx: BrowserContext;
  page: Page;
  lastLoginAt: number;
}

export class Session {
  private browser?: Browser;
  private sessions = new Map<string, SiteSession>();
  private readonly reloginAfterMs: number;
  private readonly headless: boolean;

  constructor(opts: { reloginAfterMs?: number; headless?: boolean } = {}) {
    this.reloginAfterMs = opts.reloginAfterMs ?? 20 * 60 * 1000;
    this.headless = opts.headless ?? true;
  }

  async start() {
    this.browser = await chromium.launch({ headless: this.headless });
  }

  async stop() {
    for (const s of this.sessions.values()) {
      await s.ctx.close().catch(() => {});
    }
    this.sessions.clear();
    await this.browser?.close();
  }

  async getPage(adapter: WholesaleAdapter, creds: Credentials): Promise<Page> {
    if (!this.browser) throw new Error("Session not started");

    const existing = this.sessions.get(adapter.key);
    if (existing) {
      const stale = Date.now() - existing.lastLoginAt > this.reloginAfterMs;
      if (!stale) {
        try {
          if (await adapter.isLoggedIn(existing.page)) return existing.page;
        } catch {
          // fall through to relogin
        }
      }
      await existing.ctx.close().catch(() => {});
      this.sessions.delete(adapter.key);
    }

    const ctx = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    await adapter.login(page, creds);
    this.sessions.set(adapter.key, { ctx, page, lastLoginAt: Date.now() });
    return page;
  }

  async invalidate(key: string) {
    const existing = this.sessions.get(key);
    if (!existing) return;
    await existing.ctx.close().catch(() => {});
    this.sessions.delete(key);
  }
}
