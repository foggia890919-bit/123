import { NextRequest, NextResponse } from "next/server";
import { crawlNaverShoppingPage, crawlMultipleKeywords } from "@/lib/naver/market-crawler";
import { appendRows, SHEET_TABS, ensureTabExists } from "@/lib/sheets";
import { sendTelegram } from "@/lib/telegram";
import { prisma } from "@/lib/prisma";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * 테스트용 시장 크롤링 API
 * GET /api/cron/market-crawl?keyword=올리브오일&page=1
 *
 * 구글시트에 저장:
 * - 시트: "시장조사"
 * - 헤더: 상품명, 가격, 리뷰수, 평점, 스토어명, URL, 크롤링시간
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    // 테스트는 Bearer 없이도 실행 가능하게 (나중에 제거)
    // return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const keyword = url.searchParams.get("keyword") || "올리브오일";
  const page = parseInt(url.searchParams.get("page") || "1", 10);

  try {
    console.log(`[API] 시장 크롤링 시작: ${keyword} ${page}페이지`);

    // 1. 크롤링 실행
    const result = await crawlNaverShoppingPage(keyword, page);

    // 2. 구글시트 저장 준비
    const sheetRows = result.products.map((p) => [
      p.rank,
      p.productName,
      p.price || "-",
      p.reviewCount,
      p.rating || "-",
      p.sellCount || "-",
      p.storeName,
      p.productUrl,
      p.crawledAt.toISOString(),
    ]);

    // 3. 시트 헤더 생성
    const headers = [
      "순위",
      "상품명",
      "가격",
      "리뷰수",
      "평점",
      "판매수",
      "스토어명",
      "URL",
      "크롤링시간",
    ];

    // 4. 시트에 저장 시도 (선택사항)
    const sheetResults = [];
    try {
      const workspaces = await prisma.workspace.findMany({ where: { enabled: true } });
      for (const ws of workspaces) {
        await ensureTabExists("시장조사", headers, ws);
        const res = await appendRows("시장조사!A2", sheetRows, ws);
        sheetResults.push({
          workspace: ws.name,
          ok: res.ok,
          error: res.error,
        });
      }
    } catch (sheetErr) {
      console.warn("[API] 시트 저장 오류 (무시):", sheetErr);
      sheetResults.push({ error: "구글시트 저장 안 됨" });
    }

    return NextResponse.json({
      ok: true,
      keyword,
      page,
      totalProducts: result.products.length,
      sheetResults,
      topProducts: result.products.slice(0, 5),
    });
  } catch (err) {
    console.error("[API] 크롤링 오류:", err);
    const errorMsg = err instanceof Error ? err.message : String(err);

    return NextResponse.json(
      { ok: false, error: errorMsg },
      { status: 500 }
    );
  }
}

/**
 * POST로 여러 검색어 동시 크롤링
 * POST /api/cron/market-crawl
 * Body: { keywords: ["올리브오일", "포도씨유", "참기름"] }
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    // return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { keywords?: string[] };
    const keywords = body.keywords || ["올리브오일"];

    console.log(`[API] 다중 크롤링: ${keywords.join(", ")}`);

    const results = await crawlMultipleKeywords(keywords);

    // 모든 결과를 시트에 저장
    const workspaces = await prisma.workspace.findMany({ where: { enabled: true } });
    const headers = [
      "검색어",
      "순위",
      "상품명",
      "가격",
      "리뷰수",
      "평점",
      "판매수",
      "스토어명",
      "URL",
      "크롤링시간",
    ];

    for (const ws of workspaces) {
      await ensureTabExists("시장조사", headers, ws);

      for (const result of results) {
        const sheetRows = result.products.map((p) => [
          result.keyword,
          p.rank,
          p.productName,
          p.price || "-",
          p.reviewCount,
          p.rating || "-",
          p.sellCount || "-",
          p.storeName,
          p.productUrl,
          result.crawledAt.toISOString(),
        ]);

        await appendRows("시장조사!A2", sheetRows, ws);
      }
    }

    return NextResponse.json({
      ok: true,
      totalKeywords: keywords.length,
      results: results.map((r) => ({
        keyword: r.keyword,
        productCount: r.products.length,
      })),
    });
  } catch (err) {
    console.error("[API] 다중 크롤링 오류:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
