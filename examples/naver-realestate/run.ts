// 네이버부동산 크롤링 예제 CLI.
//
// 흐름:
//   1) Playwright로 토큰 캡처 (헤드리스 chromium)
//   2) JSON API로 지역 검색 → cortarNo 획득
//   3) 필터(매물 카테고리 + 거래유형 + 면적/가격)를 걸어 매물 페이지 전부 순회
//   4) 카테고리별로 분류해 콘솔에 요약 + JSON 파일로 저장
//
// 실행:
//   npx tsx examples/naver-realestate/run.ts "강남구 역삼동"
//   npx tsx examples/naver-realestate/run.ts "강남구 역삼동" --headful
//   npx tsx examples/naver-realestate/run.ts "마포구 합정동" --pages=3

import fs from "node:fs";
import path from "node:path";

import { NaverRealestateClient } from "./api";
import { harvestSession } from "./token";
import {
  RealEstateCategory,
  RealEstateTypeLabel,
  TradeType,
  TradeTypeLabel,
} from "./filters";
import type { Article } from "./types";

interface CliArgs {
  keyword: string;
  headful: boolean;
  maxPages: number;
  outDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const flags = Object.fromEntries(
    args
      .filter((a) => a.startsWith("--"))
      .map((a) => {
        const [k, v] = a.replace(/^--/, "").split("=");
        return [k, v ?? "true"];
      }),
  );
  return {
    keyword: positional[0] ?? "강남구 역삼동",
    headful: flags.headful === "true",
    maxPages: Number(flags.pages ?? 5),
    outDir: flags.out ?? path.resolve(process.cwd(), "tmp/naver-realestate"),
  };
}

function fmtPrice(article: Article): string {
  const main = article.dealOrWarrantPrc ?? "-";
  const rent = article.rentPrc ? ` / 월 ${article.rentPrc}` : "";
  return `${main}${rent}`;
}

function classifyCategory(realEstateTypeCode: string): string {
  for (const [name, codes] of Object.entries(RealEstateCategory)) {
    if ((codes as readonly string[]).includes(realEstateTypeCode)) return name;
  }
  return "기타";
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[1/4] 토큰 캡처 (headless=${!args.headful}) ...`);
  const session = await harvestSession({ headless: !args.headful });
  console.log(`      ✓ 토큰 획득: ${session.authorization.slice(0, 24)}...`);

  const client = new NaverRealestateClient({
    authorization: session.authorization,
    cookieHeader: session.cookieHeader,
  });

  console.log(`[2/4] 지역 검색: "${args.keyword}"`);
  const regions = await client.searchRegions(args.keyword);
  if (regions.length === 0) {
    throw new Error(`지역 검색 결과 없음: ${args.keyword}`);
  }
  // 가장 정확한 매치 = 키워드 끝 단어와 cortarName 일치하는 것 우선
  const lastWord = args.keyword.trim().split(/\s+/).pop() ?? args.keyword;
  const region =
    regions.find((r) => r.cortarName === lastWord) ?? regions[0];
  console.log(
    `      ✓ ${region.cortarName} (cortarNo=${region.cortarNo}, ${region.cortarType})`,
  );

  console.log(`[3/4] 매물 수집 — 카테고리 단위로 호출 (페이지 최대 ${args.maxPages})`);
  const collected: Article[] = [];
  // 토지·상업·주거·분양권·재건축재개발 모두 포함
  const categoryEntries = Object.entries(RealEstateCategory) as [
    keyof typeof RealEstateCategory,
    readonly string[],
  ][];

  for (const [categoryName, types] of categoryEntries) {
    process.stdout.write(`      - ${categoryName} (${types.join(",")}) ... `);
    try {
      const items = await client.listAllArticles(
        {
          cortarNo: region.cortarNo,
          realEstateTypes: types,
          tradeTypes: [TradeType.A1, TradeType.B1, TradeType.B2],
          sort: "rank",
        },
        { maxPages: args.maxPages, delayMs: 400 },
      );
      collected.push(...items);
      console.log(`${items.length}건`);
    } catch (e) {
      console.log(`실패 (${(e as Error).message})`);
    }
  }

  // articleNo 기준 중복 제거 — 카테고리 묶음 사이에 겹치는 코드가 있을 수 있음
  const dedupedMap = new Map<string, Article>();
  for (const a of collected) dedupedMap.set(a.articleNo, a);
  const deduped = Array.from(dedupedMap.values());

  console.log(`[4/4] 분류 + 저장 (총 ${deduped.length}건)`);

  // 카테고리 × 거래유형 매트릭스 출력
  const matrix: Record<string, Record<string, number>> = {};
  for (const a of deduped) {
    const cat = classifyCategory(a.realEstateTypeCode);
    const trade = TradeTypeLabel[a.tradeTypeCode] ?? a.tradeTypeCode;
    matrix[cat] ??= {};
    matrix[cat][trade] = (matrix[cat][trade] ?? 0) + 1;
  }

  console.log("\n  ┌ 카테고리별 매물 분포");
  for (const [cat, trades] of Object.entries(matrix)) {
    const sum = Object.values(trades).reduce((s, n) => s + n, 0);
    const breakdown = Object.entries(trades)
      .map(([t, n]) => `${t}=${n}`)
      .join(", ");
    console.log(`  │ ${cat.padEnd(14, " ")} ${String(sum).padStart(4, " ")}건  (${breakdown})`);
  }
  console.log("  └");

  // 미리보기: 카테고리별 상위 3건씩
  console.log("\n  ─ 미리보기");
  for (const [cat, trades] of Object.entries(matrix)) {
    void trades;
    const sample = deduped
      .filter((a) => classifyCategory(a.realEstateTypeCode) === cat)
      .slice(0, 3);
    for (const a of sample) {
      const type = RealEstateTypeLabel[a.realEstateTypeCode] ?? a.realEstateTypeCode;
      const trade = TradeTypeLabel[a.tradeTypeCode] ?? a.tradeTypeCode;
      console.log(
        `    [${cat}/${type}/${trade}] ${a.articleName} — ${fmtPrice(a)}` +
          (a.area2 ? ` · 전용 ${a.area2}㎡` : "") +
          (a.floorInfo ? ` · ${a.floorInfo}` : ""),
      );
    }
  }

  // JSON 저장
  fs.mkdirSync(args.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(
    args.outDir,
    `${region.cortarName}_${stamp}.json`,
  );
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        region,
        keyword: args.keyword,
        capturedAt: session.capturedAt,
        count: deduped.length,
        matrix,
        articles: deduped,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n  → 저장: ${outPath}`);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
