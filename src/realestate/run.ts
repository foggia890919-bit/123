// CLI 진입점.
//
//   npm run re:scrape   -- --cortar 1168010100 --types 상가,사무실 --trades 매매,월세
//   npm run re:scrape   -- --watches             # 활성 워치 기반 자동
//   npm run re:detail   -- <articleNo>            # 단일 매물 상세
//   npm run re:molit    -- --endpoint commercialSale --lawd 11680 --months 6
//   npm run re:rone     -- --types OFFICE,MEDIUM,SMALL --quarters 4
//   npm run re:sbiz     -- --cortar 1168010100
//   npm run re:valuate  -- --listing <REListing.id>     # 단건 평가
//   npm run re:valuate  -- --lawd 11680 --cap 4         # 권역 추정 임대료

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { NaverRealEstateScraper } from "./naver/scraper";
import { propertyCodeOf, tradeCodeOf } from "./naver/codes";
import { upsertAgent, upsertListing, markStaleClosed } from "./storage";
import { evaluateAndNotify } from "./notify";
import { syncMolit } from "./molit/sync";
import type { MolitEndpoint } from "./molit/client";
import { syncRone, recentQuarters } from "./rone/sync";
import { snapshotDong } from "./sbiz/sync";
import { valuateListing, regionalEstimatedRent } from "./valuation";
import { geocodeJibun, getParcelByPnu, getLandUse } from "./land/vworld";
import { compute as computeMassing, DEFAULT_MEDICAL } from "./land/massing";

interface Args {
  cmd: "scrape" | "detail" | "molit" | "rone" | "sbiz" | "valuate" | "land" | "massing";
  cortarNos: string[];
  propertyTypes: string[];
  tradeTypes: string[];
  useWatches: boolean;
  detailId?: string;
  molitEndpoint?: MolitEndpoint;
  lawdCds: string[];
  months: number;
  roneTypes: ("OFFICE" | "MEDIUM" | "SMALL" | "COMPLEX")[];
  quarters: number;
  listingId?: string;
  capRate?: number;
  jibun?: string;
  pnu?: string;
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
    roneTypes: list("--types-rone", ["OFFICE", "MEDIUM", "SMALL"]) as Args["roneTypes"],
    quarters: Number(get("--quarters") ?? 4),
    listingId: get("--listing"),
    capRate: get("--cap") ? Number(get("--cap")) : undefined,
    jibun: get("--jibun"),
    pnu: get("--pnu"),
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

async function runRone(args: Args) {
  const quarters = recentQuarters(args.quarters);
  const summary = await syncRone({ buildingTypes: args.roneTypes, yearQuarters: quarters });
  console.log(`[rone] fetched=${summary.fetched} upserted=${summary.upserted} errors=${summary.errors.length}`);
  for (const e of summary.errors) console.log(`  [err] ${e.buildingType}/${e.quarter}: ${e.error}`);
}

async function runSbiz(args: Args) {
  if (args.cortarNos.length === 0) throw new Error("--cortar 1168010100 (10자리 행정동코드) 필요");
  for (const cortarNo of args.cortarNos) {
    const r = await snapshotDong(cortarNo);
    console.log(`[sbiz] cortar=${cortarNo} stores=${r.total} medical=${r.medical}`);
  }
}

async function runValuate(args: Args) {
  if (args.listingId) {
    const listing = await prisma.rEListing.findUnique({ where: { id: args.listingId } });
    if (!listing) throw new Error(`listing not found: ${args.listingId}`);
    const v = await valuateListing(listing);
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  if (args.lawdCds.length > 0) {
    for (const lawdCd of args.lawdCds) {
      const r = await regionalEstimatedRent({
        lawdCd,
        capRatePct: args.capRate ?? 4,
        months: args.months,
      });
      console.log(`[valuate] lawd=${lawdCd} trades=${r.count} 매매단가중간값=${r.pricePerM2}만/㎡ 추정월세=${r.estimatedMonthlyRentPerM2}만/㎡`);
    }
    return;
  }
  throw new Error("--listing <id> 또는 --lawd 11680 중 하나 필요");
}

async function runLand(args: Args) {
  if (!args.jibun && !args.pnu) throw new Error("--jibun '서울특별시 강남구 역삼동 825-22' 또는 --pnu 1168010100... 필요");
  let pnu = args.pnu;
  if (args.jibun && !pnu) {
    const g = await geocodeJibun(args.jibun);
    if (!g) throw new Error("지번 검색 실패");
    pnu = g.pnu;
    console.log(`[land] geocoded → pnu=${pnu} lat=${g.lat} lng=${g.lng}`);
  }
  const parcel = await getParcelByPnu(pnu!);
  const landuse = await getLandUse(pnu!);
  console.log(JSON.stringify({ parcel, landuse }, null, 2));
}

async function runMassing(args: Args) {
  if (!args.pnu) throw new Error("--pnu 1168010100... 필요");
  const parcel = await getParcelByPnu(args.pnu);
  if (!parcel || parcel.area == null) throw new Error("필지 정보 또는 면적 없음");
  const landuse = await getLandUse(args.pnu);
  const zone = landuse.zones.find(z => z.type === "용도지역")?.name ?? "";
  const result = computeMassing(
    { pnu: args.pnu, area: parcel.area, zoneName: zone },
    DEFAULT_MEDICAL,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const args = parseArgs();
  if (args.cmd === "detail") {
    if (!args.detailId) throw new Error("articleNo를 인자로 넘기세요. e.g. npm run re:detail -- 1234567890");
    await runDetail(args.detailId);
  } else if (args.cmd === "molit") {
    await runMolit(args);
  } else if (args.cmd === "rone") {
    await runRone(args);
  } else if (args.cmd === "sbiz") {
    await runSbiz(args);
  } else if (args.cmd === "valuate") {
    await runValuate(args);
  } else if (args.cmd === "land") {
    await runLand(args);
  } else if (args.cmd === "massing") {
    await runMassing(args);
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
