// 토큰을 받은 다음 fetch로 직접 호출하는 네이버부동산 내부 API 클라이언트.
// 모든 엔드포인트는 https://new.land.naver.com/api/* 아래.

import { joinTypes } from "./filters";
import type {
  Article,
  ArticleListResponse,
  ListArticlesParams,
  Region,
} from "./types";

const BASE = "https://new.land.naver.com/api";

interface ClientOptions {
  authorization: string;
  cookieHeader?: string;
}

export class NaverRealestateClient {
  private readonly authorization: string;
  private readonly cookieHeader?: string;

  constructor(opts: ClientOptions) {
    this.authorization = opts.authorization;
    this.cookieHeader = opts.cookieHeader;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: this.authorization,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ko-KR,ko;q=0.9",
      Referer: "https://new.land.naver.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    };
    if (this.cookieHeader) h["Cookie"] = this.cookieHeader;
    return h;
  }

  private async getJson<T>(path: string, params: Record<string, string | number | boolean | undefined>): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, String(v));
    }
    const url = `${BASE}${path}?${qs.toString()}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GET ${path} ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  // 1) 지역 검색 — 키워드로 cortarNo 알아내기
  async searchRegions(keyword: string): Promise<Region[]> {
    const data = await this.getJson<{ regions: Region[] }>("/regions/list", {
      keyword,
    });
    return data.regions ?? [];
  }

  // 2) 특정 지역의 하위 행정구역 (시군구→읍면동)
  async listChildRegions(cortarNo: string): Promise<Region[]> {
    const data = await this.getJson<{ regionList: Region[] }>("/regions", {
      cortarNo,
    });
    return data.regionList ?? [];
  }

  // 3) 매물 리스트 — 핵심 호출
  async listArticles(params: ListArticlesParams): Promise<ArticleListResponse> {
    const {
      cortarNo,
      realEstateTypes,
      tradeTypes,
      page = 1,
      sort = "rank",
      areaMin,
      areaMax,
      priceMin,
      priceMax,
      rentMin,
      rentMax,
      onlyVerifiedListings,
    } = params;

    return this.getJson<ArticleListResponse>("/articles", {
      cortarNo,
      realEstateType: joinTypes(realEstateTypes),
      tradeType: tradeTypes ? joinTypes(tradeTypes) : undefined,
      page,
      order: sort,
      // 면적/가격 범위
      areaMin,
      areaMax,
      priceMin,
      priceMax,
      rentPriceMin: rentMin,
      rentPriceMax: rentMax,
      articleState: "",
      directions: "",
      onlyVerifiedListings: onlyVerifiedListings ? true : undefined,
    });
  }

  // 4) 매물 상세 — 단일 매물의 자세한 정보 (가격/특이사항/사진 등)
  async getArticle(articleNo: string): Promise<Record<string, unknown>> {
    return this.getJson<Record<string, unknown>>(`/articles/${articleNo}`, {});
  }

  // 5) 페이지네이션 자동순회 헬퍼 — 모든 페이지를 다 가져온다.
  async listAllArticles(
    params: ListArticlesParams,
    opts: { maxPages?: number; delayMs?: number; onPage?: (page: number, items: Article[]) => void } = {},
  ): Promise<Article[]> {
    const { maxPages = 50, delayMs = 350, onPage } = opts;
    const all: Article[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const r = await this.listArticles({ ...params, page });
      all.push(...r.articleList);
      onPage?.(page, r.articleList);
      if (!r.isMoreData) break;
      if (page < maxPages) await new Promise((res) => setTimeout(res, delayMs));
    }
    return all;
  }
}
