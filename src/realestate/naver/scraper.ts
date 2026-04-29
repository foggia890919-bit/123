// 네이버부동산 매물 수집기.
//
// 동작 원리:
//   1) 일반 사용자처럼 https://new.land.naver.com 페이지를 Playwright로 열고
//      브라우저가 호출하는 내부 API (`/api/articles`) 의 Authorization 토큰을
//      가로챈다. 토큰은 ~30분 유효.
//   2) 이후엔 fetch 로 JSON 만 받아오므로 HTML 파싱이 필요 없다.
//   3) 요청 사이에 `RE_SCRAPE_INTERVAL_MS`(기본 3000ms) 만큼 sleep — 네이버
//      서버 부담 최소화 + 차단 회피.
//
// 주의: 본 도구는 **개인용**으로만 사용. 약관상 자동수집은 금지이며, 수집한
// 중개사 연락처를 동의 없는 광고/마케팅에 사용하면 정보통신망법 위반.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { RawAgent, RawListing, SearchQuery } from "../types";
import { propertyLabelOf, tradeLabelOf } from "./codes";

const BASE = "https://new.land.naver.com";
const ARTICLES_API = `${BASE}/api/articles`;
const ARTICLE_DETAIL_API = `${BASE}/api/articles`;
const REGIONS_API = `${BASE}/api/regions/list`;

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface SessionState {
  browser: Browser;
  ctx: BrowserContext;
  page: Page;
  authToken: string | null;
  capturedAt: number;
}

export interface ScraperOptions {
  intervalMs?: number;
  headless?: boolean;
  maxPagesPerQuery?: number;
}

export class NaverRealEstateScraper {
  private state?: SessionState;
  private readonly intervalMs: number;
  private readonly headless: boolean;
  private readonly maxPagesPerQuery: number;
  private lastRequestAt = 0;

  constructor(opts: ScraperOptions = {}) {
    this.intervalMs = opts.intervalMs ?? Number(process.env.RE_SCRAPE_INTERVAL_MS ?? 3000);
    this.headless = opts.headless ?? true;
    this.maxPagesPerQuery = opts.maxPagesPerQuery ?? 5;
  }

  async start() {
    const browser = await chromium.launch({
      headless: this.headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const ctx = await browser.newContext({
      userAgent: DEFAULT_UA,
      viewport: { width: 1440, height: 900 },
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });
    const page = await ctx.newPage();

    // 내부 API 호출에서 Authorization 헤더 가로채기
    let authToken: string | null = null;
    page.on("request", req => {
      const url = req.url();
      if (url.startsWith(ARTICLES_API) || url.includes("/api/")) {
        const auth = req.headers()["authorization"];
        if (auth && auth.startsWith("Bearer ")) authToken = auth;
      }
    });

    await page.goto(`${BASE}/offices?ms=37.5665,126.9780,15&a=SG:SMS:GJCG&e=RETAIL`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    // 토큰이 잡힐 때까지 잠깐 대기
    for (let i = 0; i < 20 && !authToken; i++) await sleep(500);

    this.state = { browser, ctx, page, authToken, capturedAt: Date.now() };
  }

  async stop() {
    await this.state?.ctx.close().catch(() => {});
    await this.state?.browser.close().catch(() => {});
    this.state = undefined;
  }

  private async throttle() {
    const wait = this.intervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private async refreshTokenIfStale() {
    if (!this.state) throw new Error("scraper not started");
    const age = Date.now() - this.state.capturedAt;
    if (age < 25 * 60 * 1000 && this.state.authToken) return;
    await this.state.page.reload({ waitUntil: "domcontentloaded" });
    for (let i = 0; i < 20 && !this.state.authToken; i++) await sleep(500);
    this.state.capturedAt = Date.now();
  }

  private headers(): Record<string, string> {
    if (!this.state?.authToken) {
      // 토큰이 없어도 API는 일부 응답을 주지만 401일 수도 있다.
      return { "User-Agent": DEFAULT_UA, Referer: BASE };
    }
    return {
      "User-Agent": DEFAULT_UA,
      Referer: BASE,
      Authorization: this.state.authToken,
    };
  }

  /** 행정구역 코드(cortarNo) 검색 — 시·구·동 단계별로 호출. */
  async listRegions(parentCortarNo = "0000000000"): Promise<RegionEntry[]> {
    await this.throttle();
    const url = `${REGIONS_API}?cortarNo=${encodeURIComponent(parentCortarNo)}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`regions ${res.status}`);
    const json = (await res.json()) as { regionList?: RegionEntry[] };
    return json.regionList ?? [];
  }

  /** 단일 검색 조건으로 매물 목록을 페이지네이션해서 모두 가져온다. */
  async search(query: SearchQuery): Promise<RawListing[]> {
    await this.refreshTokenIfStale();
    const out: RawListing[] = [];
    const startPage = query.page ?? 1;
    for (let page = startPage; page < startPage + this.maxPagesPerQuery; page++) {
      await this.throttle();
      const url = buildArticlesUrl({ ...query, page });
      const res = await fetch(url, { headers: this.headers() });
      if (res.status === 401) {
        await this.refreshTokenIfStale();
        page--; // retry
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`articles ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = (await res.json()) as ArticlesResponse;
      const items = json.articleList ?? [];
      for (const a of items) out.push(toRawListing(a));
      if (!json.isMoreData || items.length === 0) break;
    }
    return out;
  }

  /** 단일 매물의 상세(중개사 연락처 포함). */
  async detail(articleNo: string): Promise<{ listing: Partial<RawListing>; agent: RawAgent | null }> {
    await this.refreshTokenIfStale();
    await this.throttle();
    const url = `${ARTICLE_DETAIL_API}/${articleNo}?complexNo=`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`detail ${res.status}`);
    const json = (await res.json()) as ArticleDetail;
    return {
      listing: extractDetail(json),
      agent: extractAgent(json),
    };
  }
}

interface RegionEntry {
  cortarNo: string;
  cortarName: string;
  centerLat: number;
  centerLon: number;
  cortarType: string;
}

interface ArticlesResponse {
  isMoreData?: boolean;
  articleList?: NaverArticle[];
}

interface NaverArticle {
  articleNo: string;
  articleName?: string;
  realEstateTypeCode?: string;
  realEstateTypeName?: string;
  tradeTypeCode?: string;
  tradeTypeName?: string;
  cortarNo?: string;
  area1?: number; // 공급
  area2?: number; // 전용
  floorInfo?: string;
  dealOrWarrantPrc?: string;
  rentPrc?: string;
  articleFeatureDesc?: string;
  tagList?: string[];
  detailAddress?: string;
  buildingName?: string;
  realtorName?: string;
  cpid?: string;
  latitude?: string;
  longitude?: string;
  articleConfirmYmd?: string;
}

interface ArticleDetail {
  articleDetail?: {
    articleNo: string;
    articleName?: string;
    cortarNo?: string;
    detailAddress?: string;
    exposureAddress?: string;
    realEstateTypeName?: string;
    tradeTypeName?: string;
    floorLayerName?: string;
    parkingCount?: number;
    detailDescription?: string;
    tagList?: string[];
    articleConfirmYmd?: string;
  };
  articlePrice?: {
    dealPrice?: number;
    warrantPrice?: number;
    rentPrice?: number;
  };
  articleSpace?: {
    supplySpace?: number;
    exclusiveSpace?: number;
  };
  articleRealtor?: {
    realtorId?: string;
    realtorName?: string;
    representativeName?: string;
    cellPhoneNo?: string;
    representativeTelNo?: string;
    address?: string;
    establishRegistrationNo?: string;
  };
}

function buildArticlesUrl(q: SearchQuery & { page: number }): string {
  const params = new URLSearchParams({
    cortarNo: q.cortarNo,
    order: "rank",
    realEstateType: (q.propertyTypes ?? ["SG", "SMS", "GJCG"]).join(":"),
    tradeType: (q.tradeTypes ?? ["A1", "B1", "B2"]).join(":"),
    page: String(q.page),
  });
  if (q.priceMin != null) params.set("priceMin", String(q.priceMin));
  if (q.priceMax != null) params.set("priceMax", String(q.priceMax));
  return `${ARTICLES_API}?${params.toString()}`;
}

function toRawListing(a: NaverArticle): RawListing {
  return {
    externalId: a.articleNo,
    url: `${BASE}/articles/${a.articleNo}`,
    tradeType: a.tradeTypeName ?? tradeLabelOf(a.tradeTypeCode),
    propertyType: a.realEstateTypeName ?? propertyLabelOf(a.realEstateTypeCode),
    title: a.articleName ?? a.buildingName ?? null,
    cortarNo: a.cortarNo ?? null,
    address: a.detailAddress ?? null,
    region: null,
    latitude: a.latitude ? Number(a.latitude) : null,
    longitude: a.longitude ? Number(a.longitude) : null,
    ...parsePrices(a),
    areaSupply: a.area1 ?? null,
    areaExclusive: a.area2 ?? null,
    floor: a.floorInfo ?? null,
    description: a.articleFeatureDesc ?? null,
    features: a.tagList ?? [],
    postedAt: parseYmd(a.articleConfirmYmd),
    agent: a.realtorName
      ? {
          externalId: a.cpid ?? `realtor:${a.realtorName}`,
          name: a.realtorName,
          phone: null,
          address: null,
          representative: null,
          registrationNo: null,
        }
      : null,
    raw: a as unknown as Record<string, unknown>,
  };
}

function parsePrices(a: NaverArticle): Pick<RawListing, "priceSale" | "priceDeposit" | "priceMonthly"> {
  const trade = a.tradeTypeCode ?? "";
  const main = parseManwon(a.dealOrWarrantPrc);
  const monthly = parseManwon(a.rentPrc);
  if (trade === "A1") return { priceSale: main, priceDeposit: null, priceMonthly: null };
  if (trade === "B1") return { priceSale: null, priceDeposit: main, priceMonthly: null };
  return { priceSale: null, priceDeposit: main, priceMonthly: monthly };
}

// "1억 5,000" / "8,500" / "120/15" 같은 표기를 만원 단위 정수로 변환
function parseManwon(s?: string | null): number | null {
  if (!s) return null;
  const cleaned = s.replace(/,/g, "").trim();
  const eok = /(\d+)억/.exec(cleaned);
  const remainder = cleaned.replace(/(\d+)억/, "").replace(/[^\d]/g, "");
  const eokVal = eok ? Number(eok[1]) * 10_000 : 0;
  const remVal = remainder ? Number(remainder) : 0;
  const total = eokVal + remVal;
  return total > 0 ? total : null;
}

function parseYmd(s?: string | null): Date | null {
  if (!s || s.length !== 8) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function extractAgent(d: ArticleDetail): RawAgent | null {
  const r = d.articleRealtor;
  if (!r?.realtorId && !r?.realtorName) return null;
  return {
    externalId: r.realtorId ?? `name:${r.realtorName}`,
    name: r.realtorName ?? "",
    phone: r.cellPhoneNo ?? r.representativeTelNo ?? null,
    address: r.address ?? null,
    representative: r.representativeName ?? null,
    registrationNo: r.establishRegistrationNo ?? null,
  };
}

function extractDetail(d: ArticleDetail): Partial<RawListing> {
  const a = d.articleDetail ?? {};
  const p = d.articlePrice ?? {};
  const s = d.articleSpace ?? {};
  return {
    title: a.articleName ?? null,
    address: a.exposureAddress ?? a.detailAddress ?? null,
    description: a.detailDescription ?? null,
    features: a.tagList ?? [],
    priceSale: p.dealPrice ?? null,
    priceDeposit: p.warrantPrice ?? null,
    priceMonthly: p.rentPrice ?? null,
    areaSupply: s.supplySpace ?? null,
    areaExclusive: s.exclusiveSpace ?? null,
    floor: a.floorLayerName ?? null,
    postedAt: parseYmd(a.articleConfirmYmd),
  };
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}
