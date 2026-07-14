import * as cheerio from "cheerio";

export interface MarketProduct {
  rank: number;
  productName: string;
  storeName: string;
  price: number | null;
  reviewCount: number;
  rating: number | null;
  brand: string | null;
  productUrl: string;
  imageUrl: string | null;
  sellCount: number | null;
}

export interface MarketCrawlResult {
  keyword: string;
  page: number;
  products: MarketProduct[];
  totalCount: number;
  crawledAt: Date;
}

const SCRAPER_API_URL = "https://api.scraperapi.com";

/**
 * ScraperAPI + Cheerio로 네이버 쇼핑 크롤링
 * - HTTPS 프록시 자동 처리
 * - 봇 차단 우회
 */
export async function crawlNaverShoppingPage(
  keyword: string,
  page: number = 1,
): Promise<MarketCrawlResult> {
  try {
    const searchUrl = `https://shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}&pagingIndex=${page}`;

    console.log(`[Crawler] ${keyword} 검색, ${page}페이지 크롤링 시작... (ScraperAPI)`);

    // ScraperAPI로 HTML 가져오기
    const html = await fetchWithScraperAPI(searchUrl);

    // Cheerio로 파싱
    const $ = cheerio.load(html);

    // 상품 추출
    const products: MarketProduct[] = [];
    let rank = 1;

    // 네이버 쇼핑의 상품 리스트 구조 파싱
    $("li[data-product-id], div[data-product-id]").each((idx, el) => {
      try {
        // 상품명
        const productName = $(el)
          .find("a.product_title, a[class*='title']")
          .text()
          .trim();
        if (!productName) return; // 상품명이 없으면 스킵

        const productUrl =
          $(el)
            .find("a.product_title, a[class*='title']")
            .attr("href") || "";

        // 가격
        const priceText = $(el)
          .find(".price_area strong, [class*='price'] strong")
          .text()
          .replace(/[^0-9]/g, "");
        const price = priceText ? parseInt(priceText, 10) : null;

        // 스토어명
        const storeName = $(el)
          .find(".mall_link, [class*='seller'], [class*='store']")
          .text()
          .trim() || "Unknown";

        // 리뷰 수
        const reviewText = $(el)
          .find(".review_count, [class*='review']")
          .text()
          .match(/\d+/)?.[0] || "0";
        const reviewCount = parseInt(reviewText, 10);

        // 평점
        const ratingText = $(el)
          .find("[class*='rating'], [class*='star']")
          .attr("data-rating") ||
          $(el)
            .find("[class*='rating'], [class*='star']")
            .text()
            .match(/[\d.]+/)?.[0] ||
          "";
        const rating = ratingText ? parseFloat(ratingText) : null;

        // 이미지
        const imageUrl = $(el).find("img").attr("src") ||
          $(el).find("img").attr("data-src") || null;

        // 판매 수 (리뷰 수로 추정)
        const sellCount = reviewCount > 0 ? Math.ceil(reviewCount * 1.5) : 0;

        products.push({
          rank,
          productName,
          storeName,
          price,
          reviewCount,
          rating,
          brand: null,
          productUrl,
          imageUrl,
          sellCount,
        });

        rank++;
      } catch (err) {
        console.warn(`[Crawler] 상품 파싱 실패:`, err);
      }
    });

    console.log(`[Crawler] ${products.length}개 상품 추출 완료`);

    return {
      keyword,
      page,
      products: products.slice(0, 40), // 최대 40개
      totalCount: products.length,
      crawledAt: new Date(),
    };
  } catch (err) {
    console.error("[Crawler] 크롤링 실패:", err);
    throw err;
  }
}

/**
 * ScraperAPI를 통해 URL의 HTML 가져오기
 * premium=true로 보호된 도메인(네이버) 접근
 */
async function fetchWithScraperAPI(targetUrl: string): Promise<string> {
  const apiKey = process.env.SCRAPER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SCRAPER_API_KEY 환경변수가 설정되지 않았습니다. .env에 SCRAPER_API_KEY를 추가하세요.",
    );
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    url: targetUrl,
    premium: "true", // 보호된 도메인(네이버) 접근용
    ultra_premium: "false",
  });

  const url = `${SCRAPER_API_URL}?${params}`;

  console.log(`[ScraperAPI] 요청 시작... (Premium mode)`);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ScraperAPI error ${res.status}: ${text}`);
  }

  const html = await res.text();
  console.log(`[ScraperAPI] HTML 수신 완료 (${html.length} bytes)`);

  return html;
}

/**
 * 여러 검색어에 대해 1페이지씩 크롤링
 */
export async function crawlMultipleKeywords(keywords: string[]): Promise<MarketCrawlResult[]> {
  const results: MarketCrawlResult[] = [];

  for (const keyword of keywords) {
    try {
      const result = await crawlNaverShoppingPage(keyword, 1);
      results.push(result);

      // 요청 간 딜레이
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`[Crawler] ${keyword} 크롤링 실패:`, err);
    }
  }

  return results;
}
