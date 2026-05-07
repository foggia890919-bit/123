// Playwright로 new.land.naver.com 에 접속해서, 페이지가 내부 API를 호출할 때
// 보내는 Authorization Bearer 토큰을 네트워크 인터셉트로 캡처한다.
//
// 이 토큰은 약 30~60분 정도 유효 (페이지 SPA가 주기적으로 재발급).
// 캡처 후 chromium은 닫고, 그 다음부터는 fetch로 직접 API를 친다 (하이브리드).

import { chromium, type Browser } from "playwright";

export interface HarvestedSession {
  authorization: string;     // "Bearer ey..."
  cookieHeader: string;      // 쿠키 직렬화 (선택적이지만 일부 엔드포인트에서 필요)
  capturedAt: number;
}

interface HarvestOptions {
  headless?: boolean;
  // 토큰 캡처를 시작할 트리거 — 검색박스에 임의 키워드를 입력해 자동완성 호출 유도
  triggerKeyword?: string;
  timeoutMs?: number;
}

export async function harvestSession(opts: HarvestOptions = {}): Promise<HarvestedSession> {
  const {
    headless = true,
    triggerKeyword = "강남",
    timeoutMs = 30_000,
  } = opts;

  const browser: Browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    locale: "ko-KR",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  let authorization: string | undefined;
  page.on("request", (req) => {
    if (authorization) return;
    const url = req.url();
    if (!url.includes("new.land.naver.com/api/")) return;
    const headers = req.headers();
    const auth = headers["authorization"];
    if (auth && auth.toLowerCase().startsWith("bearer ")) {
      authorization = auth;
    }
  });

  try {
    await page.goto("https://new.land.naver.com/", {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    // 페이지가 자체적으로 /api/regions, /api/articles 등을 호출하지만
    // 일부 환경에서는 사용자 인터랙션이 있어야 호출되는 경우가 있어 검색을 한 번 시도.
    const searchInput = page.locator('input[placeholder*="지역"], input[type="search"]').first();
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.click();
      await searchInput.type(triggerKeyword, { delay: 50 });
      await page.waitForTimeout(2000);
    }

    // 토큰 캡처 대기 — 최대 timeoutMs
    const start = Date.now();
    while (!authorization && Date.now() - start < timeoutMs) {
      await page.waitForTimeout(300);
    }
    if (!authorization) {
      throw new Error("Authorization 토큰을 캡처하지 못했습니다. headless=false로 다시 시도해보세요.");
    }

    const cookies = await context.cookies();
    const cookieHeader = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    return {
      authorization,
      cookieHeader,
      capturedAt: Date.now(),
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
