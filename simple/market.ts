/**
 * 시장조사 자동화
 *
 * 데이터 소스:
 *   1. DataLab 쇼핑인사이트 (스크래핑) — 카테고리 트리, 카테고리별 Top500 키워드
 *   2. 네이버 검색광고 API (공식) — 키워드 절대 검색량 + 연관 키워드
 *   3. (Phase 2 별도) 네이버 쇼핑 검색결과 페이지 — 시장 매출/판매량
 *
 * 시트 탭:
 *   「시장조사_카테고리」  — 전체 카테고리 트리 + 사장님이 ✓ 표시한 추적 카테고리
 *   「시장조사_키워드」    — 카테고리별 Top500 키워드 + 검색량
 *
 * 환경변수:
 *   GOOGLE_*                          시트
 *   NAVER_AD_API_KEY                  검색광고 API 키
 *   NAVER_AD_SECRET                   검색광고 시크릿
 *   NAVER_AD_CUSTOMER_ID              검색광고 Customer ID
 */

import "dotenv/config";
import { createHmac } from "node:crypto";
import { ensureTab, upsertRows, readRange, loadCredsFromEnv, type SheetCreds } from "./sheets";

const SHEET_CREDS: SheetCreds | null = loadCredsFromEnv();
const AD_API_KEY = process.env.NAVER_AD_API_KEY;
const AD_SECRET = process.env.NAVER_AD_SECRET;
const AD_CUSTOMER_ID = process.env.NAVER_AD_CUSTOMER_ID;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";

// ─────────────────── DataLab 카테고리 트리 (스크래핑)

interface CategoryNode {
  cid: string;
  name: string;
  parent: string;
  level: number;
  childCount: number;
}

async function fetchCategoryChildren(parentCid: string): Promise<{ cid: string; name: string; childCount: number }[]> {
  const res = await fetch("https://datalab.naver.com/shoppingInsight/getCategory.naver", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": UA,
      Referer: "https://datalab.naver.com/shoppingInsight/sCategory.naver",
      Accept: "application/json, text/plain, */*",
    },
    body: `cid=${encodeURIComponent(parentCid)}`,
  });
  if (!res.ok) throw new Error(`category ${parentCid}: ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  const data = (await res.json()) as { childList?: { cid: string; name: string; childCount: number }[] };
  return data.childList ?? [];
}

async function fetchCategoryTree(): Promise<CategoryNode[]> {
  const out: CategoryNode[] = [];
  const visit = async (parentCid: string, level: number): Promise<void> => {
    const children = await fetchCategoryChildren(parentCid);
    for (const c of children) {
      out.push({ cid: c.cid, name: c.name, parent: parentCid, level, childCount: c.childCount });
      if (c.childCount > 0 && level < 4) {
        await sleep(500);
        await visit(c.cid, level + 1);
      }
    }
  };
  await visit("0", 1); // root
  return out;
}

// ─────────────────── DataLab 카테고리 인기검색어 Top N (스크래핑)

interface RankedKeyword {
  keyword: string;
  rank: number;
}

async function fetchCategoryTopKeywords(cid: string, count = 500): Promise<RankedKeyword[]> {
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const all: RankedKeyword[] = [];
  const PAGE_SIZE = 25;
  const totalPages = Math.ceil(count / PAGE_SIZE);

  for (let page = 1; page <= totalPages; page++) {
    const body = new URLSearchParams({
      cid,
      timeUnit: "date",
      startDate: fmt(monthAgo),
      endDate: fmt(today),
      age: "",
      gender: "",
      device: "",
      page: String(page),
      count: String(PAGE_SIZE),
    });
    const res = await fetch("https://datalab.naver.com/shoppingInsight/getCategoryKeywordRank.naver", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": UA,
        Referer: "https://datalab.naver.com/shoppingInsight/sCategory.naver",
        Accept: "application/json, text/plain, */*",
      },
      body,
    });
    if (!res.ok) {
      console.warn(`[${cid}] page ${page} 실패: ${res.status}`);
      break;
    }
    const data = (await res.json()) as { ranks?: { keyword: string; rank: number }[] };
    const ranks = data.ranks ?? [];
    if (ranks.length === 0) break;
    all.push(...ranks.map((r) => ({ keyword: r.keyword, rank: r.rank })));
    if (ranks.length < PAGE_SIZE) break;
    await sleep(800); // 키워드 페이지 사이 딜레이
  }
  return all;
}

// ─────────────────── 검색광고 API: 키워드 도구 (검색량 + 연관 키워드)

interface AdKeywordRow {
  keyword: string;
  monthlyPcQcCnt: number;
  monthlyMobileQcCnt: number;
  monthlyAvePcCtr: number;
  monthlyAveMobileCtr: number;
  compIdx: string; // "낮음" | "중간" | "높음"
}

function adSign(method: string, path: string, ts: string): string {
  if (!AD_SECRET) throw new Error("NAVER_AD_SECRET 없음");
  return createHmac("sha256", AD_SECRET).update(`${ts}.${method}.${path}`).digest("base64");
}

async function fetchKeywordTool(hintKeywords: string[]): Promise<AdKeywordRow[]> {
  if (!AD_API_KEY || !AD_SECRET || !AD_CUSTOMER_ID) {
    throw new Error("검색광고 API 키 누락 (NAVER_AD_API_KEY/SECRET/CUSTOMER_ID)");
  }
  const path = "/keywordstool";
  const ts = String(Date.now());
  const params = new URLSearchParams({
    hintKeywords: hintKeywords.join(","),
    showDetail: "1",
  });
  const url = `https://api.naver.com${path}?${params}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-Timestamp": ts,
      "X-API-KEY": AD_API_KEY,
      "X-Customer": AD_CUSTOMER_ID,
      "X-Signature": adSign("GET", path, ts),
    },
  });
  if (!res.ok) throw new Error(`keywordstool ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { keywordList?: AdKeywordRow[] };
  return data.keywordList ?? [];
}

function num(v: number | string | undefined): number {
  if (v === undefined || v === null || v === "< 10") return 0;
  return Number(v) || 0;
}

// ─────────────────── 메인

async function dumpCategoryTree(creds: SheetCreds): Promise<void> {
  console.log("[1/3] 카테고리 트리 수집…");
  const tree = await fetchCategoryTree();
  console.log(`  → ${tree.length} 개 카테고리`);

  await ensureTab(creds, "시장조사_카테고리", ["코드", "1차", "2차", "3차", "4차", "추적"]);
  // 부모 체인 만들기
  const cidToNode = new Map(tree.map((n) => [n.cid, n]));
  const cidToChain = (cid: string): string[] => {
    const chain: string[] = [];
    let cur: CategoryNode | undefined = cidToNode.get(cid);
    while (cur) {
      chain.unshift(cur.name);
      cur = cidToNode.get(cur.parent);
    }
    return chain;
  };
  const rows: (string | number)[][] = tree.map((n) => {
    const chain = cidToChain(n.cid);
    return [
      n.cid,
      chain[0] ?? "",
      chain[1] ?? "",
      chain[2] ?? "",
      chain[3] ?? "",
      "", // 추적 칼럼 — 사장님이 ✓ 표시
    ];
  });
  await upsertRows(creds, "시장조사_카테고리", rows, (r) => String(r[0] ?? ""));
  console.log(`✅ 「시장조사_카테고리」 ${rows.length}행`);
}

async function fetchTrackedCategories(creds: SheetCreds): Promise<{ cid: string; name: string }[]> {
  const rows = await readRange(creds, "시장조사_카테고리!A2:F10000");
  return rows
    .filter((r) => r[5] && /^(o|O|ㅇ|y|Y|✓|true|1)$/i.test(String(r[5]).trim()))
    .map((r) => ({
      cid: String(r[0]),
      name: [r[4], r[3], r[2], r[1]].find((x) => x) || "",
    }));
}

async function dumpKeywordsForTrackedCategories(creds: SheetCreds): Promise<void> {
  const tracked = await fetchTrackedCategories(creds);
  if (tracked.length === 0) {
    console.log("\n⚠️ 추적 카테고리 없음 — 시트 「시장조사_카테고리」 의 F열(추적) 에 'o' 표시한 행만 처리됩니다.");
    return;
  }
  console.log(`\n[2/3] 추적 ${tracked.length}개 카테고리 키워드 수집…`);

  await ensureTab(creds, "시장조사_키워드", [
    "카테고리코드",
    "카테고리명",
    "키워드",
    "DataLab순위",
    "월검색량(PC)",
    "월검색량(모바일)",
    "월검색량(합)",
    "PC클릭률",
    "모바일클릭률",
    "경쟁도",
    "수집일",
  ]);

  const today = new Date().toISOString().slice(0, 10);

  for (const cat of tracked) {
    console.log(`  [${cat.name}] (${cat.cid}) Top500 수집…`);
    const ranked = await fetchCategoryTopKeywords(cat.cid, 500);
    console.log(`    → ${ranked.length} 키워드`);
    if (ranked.length === 0) continue;

    // 검색광고 API 로 보강 (5개씩 배치)
    const enrichedMap = new Map<string, AdKeywordRow>();
    if (AD_API_KEY) {
      const BATCH = 5;
      for (let i = 0; i < ranked.length; i += BATCH) {
        const batch = ranked.slice(i, i + BATCH).map((r) => r.keyword);
        try {
          const ad = await fetchKeywordTool(batch);
          for (const row of ad) {
            enrichedMap.set(row.keyword.toLowerCase(), row);
          }
        } catch (err) {
          console.warn(`    ad ${i}: ${err instanceof Error ? err.message : String(err)}`);
        }
        await sleep(300);
      }
    }

    const rows: (string | number)[][] = ranked.map((rk) => {
      const ad = enrichedMap.get(rk.keyword.toLowerCase());
      const pc = num(ad?.monthlyPcQcCnt);
      const mb = num(ad?.monthlyMobileQcCnt);
      return [
        cat.cid,
        cat.name,
        rk.keyword,
        rk.rank,
        pc,
        mb,
        pc + mb,
        num(ad?.monthlyAvePcCtr),
        num(ad?.monthlyAveMobileCtr),
        ad?.compIdx ?? "",
        today,
      ];
    });
    await upsertRows(creds, "시장조사_키워드", rows, (r) => `${r[0]}|${r[2]}`);
    console.log(`    ✅ 「시장조사_키워드」 ${rows.length}행 추가/갱신`);
    await sleep(1500);
  }
}

async function main(): Promise<void> {
  if (!SHEET_CREDS) throw new Error("Google Sheet 환경변수 없음");

  const arg = process.argv[2];
  if (!arg || arg === "tree") {
    await dumpCategoryTree(SHEET_CREDS);
    if (arg === "tree") return;
  }
  if (!arg || arg === "keywords") {
    await dumpKeywordsForTrackedCategories(SHEET_CREDS);
    if (arg === "keywords") return;
  }
  console.log("\n✅ 완료");
  console.log("\n사용법:");
  console.log("  npx tsx market.ts          # 카테고리 트리 + 키워드 (둘 다)");
  console.log("  npx tsx market.ts tree     # 카테고리 트리만");
  console.log("  npx tsx market.ts keywords # 키워드만 (사장님 ✓ 표시한 카테고리)");
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
