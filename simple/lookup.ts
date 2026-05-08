/**
 * 키워드 검색량 조회 (CLI)
 *
 * 사용법:
 *   npx tsx lookup.ts 올리브오일
 *   npx tsx lookup.ts 끌로에 가방
 *
 * 출력:
 *   - 본 키워드의 PC/모바일 월 검색수, 클릭률, 경쟁도
 *   - 연관 키워드 Top 20 + 각 검색량
 *
 * 데이터 소스: 네이버 검색광고 API 「키워드 도구」
 * https://manage.searchad.naver.com → 내 정보 → API 사용 관리
 */

import "dotenv/config";
import { createHmac } from "node:crypto";

const AD_API_KEY = process.env.NAVER_AD_API_KEY;
const AD_SECRET = process.env.NAVER_AD_SECRET;
const AD_CUSTOMER_ID = process.env.NAVER_AD_CUSTOMER_ID;

interface AdRow {
  relKeyword: string;
  monthlyPcQcCnt: number | string;
  monthlyMobileQcCnt: number | string;
  monthlyAvePcCtr: number | string;
  monthlyAveMobileCtr: number | string;
  monthlyAvePcClkCnt?: number | string;
  monthlyAveMobileClkCnt?: number | string;
  compIdx: string;
  plAvgDepth?: number;
}

function adSign(method: string, path: string, ts: string): string {
  if (!AD_SECRET) throw new Error("NAVER_AD_SECRET 없음");
  return createHmac("sha256", AD_SECRET).update(`${ts}.${method}.${path}`).digest("base64");
}

function num(v: unknown): number {
  if (v === "< 10") return 0;
  return Number(v) || 0;
}

function pad(s: string, n: number, right = false): string {
  // 한글 = 2 width
  const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
  const pad = " ".repeat(Math.max(0, n - w));
  return right ? pad + s : s + pad;
}

async function lookup(keyword: string): Promise<void> {
  if (!AD_API_KEY || !AD_SECRET || !AD_CUSTOMER_ID) {
    console.error("❌ 검색광고 API 키 누락.");
    console.error("");
    console.error("발급 방법:");
    console.error("  1. https://manage.searchad.naver.com 가입 (사업자번호)");
    console.error("  2. 우상단 「내 정보」 → 「API 사용 관리」");
    console.error("  3. 「액세스 라이선스 발급」 클릭");
    console.error("");
    console.error(".env 에 추가:");
    console.error("  NAVER_AD_API_KEY=...");
    console.error("  NAVER_AD_SECRET=...");
    console.error("  NAVER_AD_CUSTOMER_ID=...");
    process.exit(1);
  }

  const path = "/keywordstool";
  const ts = String(Date.now());
  const params = new URLSearchParams({
    hintKeywords: keyword,
    showDetail: "1",
  });
  const url = `https://api.naver.com${path}?${params}`;

  const res = await fetch(url, {
    headers: {
      "X-Timestamp": ts,
      "X-API-KEY": AD_API_KEY,
      "X-Customer": AD_CUSTOMER_ID,
      "X-Signature": adSign("GET", path, ts),
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`❌ API 오류 ${res.status}: ${errText.slice(0, 200)}`);
    process.exit(1);
  }

  const data = (await res.json()) as { keywordList?: AdRow[] };
  const list = data.keywordList ?? [];

  if (list.length === 0) {
    console.log(`\n🔍 「${keyword}」 — 데이터 없음 (검색량 너무 적거나 키워드 없음)`);
    return;
  }

  // 본 키워드 + 연관 키워드 분리
  const main = list.find((k) => k.relKeyword === keyword || k.relKeyword === keyword.replace(/\s+/g, ""));
  const related = list.filter((k) => k !== main);

  console.log("");
  if (main) {
    const pc = num(main.monthlyPcQcCnt);
    const mb = num(main.monthlyMobileQcCnt);
    const total = pc + mb;
    console.log(`🔍 「${keyword}」 검색량 분석`);
    console.log("─".repeat(50));
    console.log(`  PC 월 검색수       ${pc.toLocaleString().padStart(10)} 회`);
    console.log(`  모바일 월 검색수   ${mb.toLocaleString().padStart(10)} 회`);
    console.log(`  ─────────────────────────────`);
    console.log(`  합계               ${total.toLocaleString().padStart(10)} 회/월`);
    console.log("");
    console.log(`  PC 클릭률          ${num(main.monthlyAvePcCtr).toFixed(2)}%`);
    console.log(`  모바일 클릭률      ${num(main.monthlyAveMobileCtr).toFixed(2)}%`);
    console.log(`  경쟁도             ${main.compIdx}`);
    if (main.plAvgDepth !== undefined) {
      console.log(`  광고 평균 노출 위치 ${main.plAvgDepth}`);
    }
    console.log("");
  } else {
    console.log(`🔍 「${keyword}」 본 키워드 데이터 없음 (검색량 < 10 또는 미등록)`);
    console.log("");
  }

  if (related.length > 0) {
    related.sort((a, b) => num(b.monthlyPcQcCnt) + num(b.monthlyMobileQcCnt) - num(a.monthlyPcQcCnt) - num(a.monthlyMobileQcCnt));
    const top = related.slice(0, 20);
    console.log(`📋 연관 키워드 Top ${top.length}`);
    console.log("─".repeat(60));
    console.log(`${pad("키워드", 26)}${pad("PC", 10, true)}${pad("모바일", 12, true)}${pad("합계", 12, true)}`);
    console.log("─".repeat(60));
    for (const k of top) {
      const pc = num(k.monthlyPcQcCnt);
      const mb = num(k.monthlyMobileQcCnt);
      console.log(
        `${pad(k.relKeyword, 26)}${pad(pc.toLocaleString(), 10, true)}${pad(mb.toLocaleString(), 12, true)}${pad((pc + mb).toLocaleString(), 12, true)}`,
      );
    }
    console.log("");
    console.log(`(전체 연관 키워드 ${related.length}개, 검색량 많은 순 Top 20 표시)`);
  }
}

async function main(): Promise<void> {
  const keyword = process.argv.slice(2).join(" ").trim();
  if (!keyword) {
    console.log("");
    console.log("🔍 키워드 검색량 조회 — 네이버 검색광고 API 「키워드 도구」");
    console.log("");
    console.log("사용법:");
    console.log("  npx tsx lookup.ts 올리브오일");
    console.log("  npx tsx lookup.ts 끌로에 가방");
    console.log("");
    process.exit(0);
  }
  await lookup(keyword);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
