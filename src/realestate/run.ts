// CLI 진입점.
//
//   npm run re:scrape -- --cortar 1168010100 --types 상가,사무실 --trades 매매,월세
//   npm run re:scrape -- --watches      # 활성 워치의 cortarNo 조합으로 자동 검색
//   npm run re:molit  -- --endpoint commercialSale --lawd 11680 --months 6
//   npm run re:detail -- <articleNo>    # 특정 매물 상세(중개사 포함) 단건 조회
//
// 옵션을 생략하면 .env의 RE_DEFAULT_CORTARS / RE_DEFAULT_PROPERTY_TYPES 사용.

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { NaverRealEstateScraper } from "./naver/scraper";
import { propertyCodeOf, tradeCodeOf } from "./naver/codes";
import { upsertAgent, upsertListing, markStaleClosed } from "./storage";
import { evaluateAndNotify } from "./notify";
import { syncMolit } from "./molit/sync";
import type { MolitEndpoint } from "./molit/client";

interface Args {
  cmd: "scrape" | "detail" | "molit";
  cortarNos: string[];
  propertyTypes: string[];
  tradeTypes: string[];
  useWatches: boolean;
  detailId?: string;
  molitEndpoint?: MolitEndpoint;
  lawdCds: string[];
  months: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const cmd = (argv[0] ?? "scrape") as Args["cmd"];
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const list = (flag: string, fallback: string[] = []) => {
    const v = get(flag);
    return v ? v.split(",").map(s => s.trim()).filter(Boolean) : fallback;
  };
  return {
    cmd,
    cortarNos: list("--cortar", (process.env.RE_DEFAULT_CORTARS ?? "").split(",").filter(Boolean)),
    propertyTypes: list("--types", (process.env.RE_DEFAULT_PROPERTY_TYPES ?? "상가,사무실,빌딩").split(",")),
    tradeTypes: list("--trades", (process.env.RE_DEFAULT_TRADE_TYPES ?? "매매,월세").split(",")),
    useWatches: argv.includes("--watches"),
    detailId: get("--id") ?? (cmd === "detail" ? argv[1] : undefined),
    molitEndpoint: (get("--endpoint") as MolitEndpoint | undefined) ?? "commercialSale",
    lawdCds: list("--lawd"),
    months: Number(get("--months") ?? 6),
  };
}

async function runScrape(args: Args) {
  let cortars = args.cortarNos;
  if (args.useWatches) {
    const watches = await prisma.rEWatch.findMany({ where: { enabled: true } });
    cortars = Array.from(new Set(watches.flatMap(w => w.cortarNos)));
  }
  if (cortars.length === 0) {
    throw new Error("cortarNo가 없습니다. --cortar 1168010100 또는 RE_DEFAULT_CORTARS 또는 --watches 사용.");
  }

  const tradeCodes = args.tradeTypes.map(tradeCodeOf).filter(Boolean) as string[];
  const propertyCodes = args.propertyTypes.map(propertyCodeOf).filter(Boolean) as string[];

  console.log(`[re] cortarNos=${cortars.join(",")} props=${args.propertyTypes.join("/")} trades=${args.tradeTypes.join("/")}`);

  const scraper = new NaverRealEstateScraper({});
  await scraper.start();

  let total = 0, fresh = 0, alerted = 0;
  try {
    for (const cortarNo of cortars) {
      const items = await scraper.search({
        cortarNo,
        tradeTypes: tradeCodes,
        propertyTypes: propertyCodes,
      });
      total += items.length;
      for (const raw of items) {
        const { listingId, isNew } = await upsertListing(raw);
        if (isNew) {
          fresh++;
          // 신규 매물엔 상세 호출로 중개사 연락처까지 보강 (베스트 에포트)
          try {
            const detail = await scraper.detail(raw.externalId);
            if (detail.agent) await upsertAgent(detail.agent);
          } catch (e) {
            console.warn(`[re] detail fail ${raw.externalId}: ${(e as Error).message}`);
          }
          alerted += await evaluateAndNotify(listingId);
        }
      }
      console.log(`[re] cortar=${cortarNo} fetched=${items.length}`);
    }
    const closed = await markStaleClosed();
    console.log(`[re] total=${total} new=${fresh} alerts=${alerted} closed=${closed}`);
  } finally {
    await scraper.stop();
  }
}

async function runDetail(articleNo: string) {
  const scraper = new NaverRealEstateScraper({});
  await scraper.start();
  try {
    const d = await scraper.detail(articleNo);
    console.log(JSON.stringify(d, null, 2));
  } finally {
    await scraper.stop();
  }
}

async function runMolit(args: Args) {
  if (args.lawdCds.length === 0) throw new Error("--lawd 11680 (5자리 법정동코드) 필요");
  const summary = await syncMolit({
    endpoint: args.molitEndpoint!,
    lawdCds: args.lawdCds,
    months: args.months,
  });
  console.log(`[molit] fetched=${summary.fetched} inserted=${summary.inserted} skipped=${summary.skipped} errors=${summary.errors.length}`);
  for (const e of summary.errors) console.log(`  [err] ${e.lawdCd}/${e.ymd}: ${e.error}`);
}

async function main() {
  const args = parseArgs();
  if (args.cmd === "detail") {
    if (!args.detailId) throw new Error("articleNo를 인자로 넘기세요. e.g. npm run re:detail -- 1234567890");
    await runDetail(args.detailId);
  } else if (args.cmd === "molit") {
    await runMolit(args);
  } else {
    await runScrape(args);
  }
}

main()
  .catch(err => {
    console.error("[fatal]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
