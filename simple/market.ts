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
import { ensureTab, appendRows, clearTabData, readRange, writeRange, loadCredsFromEnv, type SheetCreds } from "./sheets";

const SHEET_CREDS: SheetCreds | null = loadCredsFromEnv();
const AD_API_KEY = process.env.NAVER_AD_API_KEY;
const AD_SECRET = process.env.NAVER_AD_SECRET;
const AD_CUSTOMER_ID = process.env.NAVER_AD_CUSTOMER_ID;
const DEV_CLIENT_ID = process.env.NAVER_DEVELOPER_CLIENT_ID;
const DEV_CLIENT_SECRET = process.env.NAVER_DEVELOPER_CLIENT_SECRET;

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

let categoryDebugLogged = false;

async function fetchCategoryChildren(parentCid: string): Promise<{ cid: string; name: string; childCount: number; leaf?: boolean }[]> {
  // 429 (Too Many Requests) 시 백오프 retry — DataLab 차단 회피
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
    if (res.status === 429) {
      if (attempt === maxAttempts) {
        throw new Error(`category ${parentCid}: 429 (${maxAttempts}회 retry 후 포기)`);
      }
      const wait = 10000 * attempt; // 10s, 20s, 30s, 40s
      console.warn(`  [DataLab 429] cid=${parentCid} — ${wait / 1000}s 대기 후 재시도 ${attempt}/${maxAttempts}`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`category ${parentCid}: ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
    const data = (await res.json()) as Record<string, unknown>;
    // 진단: 첫 응답(cid=0) raw 출력 — 1회만
    if (!categoryDebugLogged) {
      categoryDebugLogged = true;
      console.log(`\n[진단3] DataLab category cid=${parentCid} 응답 raw (3000자):`);
      console.log(JSON.stringify(data, null, 2).slice(0, 3000));
      console.log(`[진단3] 끝\n`);
    }
    const childList = (data.childList as { cid: string; name: string; childCount: number; leaf?: boolean }[] | undefined) ?? [];
    return childList;
  }
  return []; // unreachable
}

async function fetchCategoryTree(): Promise<CategoryNode[]> {
  const out: CategoryNode[] = [];
  let apiCalls = 0;
  const visit = async (parentCid: string, level: number): Promise<void> => {
    const children = await fetchCategoryChildren(parentCid);
    apiCalls++;
    if (children.length === 0) return; // 빈 응답 = 더 이상 자식 없음 (자동 중단)
    for (const c of children) {
      out.push({ cid: c.cid, name: c.name, parent: parentCid, level, childCount: c.childCount });
      // leaf === true 면 더 이상 자식 없음 → 재귀 skip (호출 수 감소)
      if (level < 4 && c.leaf !== true) {
        await sleep(250); // DataLab 차단 회피
        await visit(c.cid, level + 1);
      }
    }
    if (apiCalls % 200 === 0) {
      console.log(`  [트리 진행] ${apiCalls}회 호출 / ${out.length}개 누적`);
    }
  };
  await visit("0", 1); // root
  console.log(`  [트리 완료] 총 API ${apiCalls}회 / ${out.length}개 카테고리 (level 1~4)`);
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
  relKeyword: string; // 네이버 검색광고 API 실제 필드명
  monthlyPcQcCnt: number | string;
  monthlyMobileQcCnt: number | string;
  monthlyAvePcCtr: number | string;
  monthlyAveMobileCtr: number | string;
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

// ─────────────────── 시장규모 (네이버 쇼핑 검색결과 스크래핑)

interface MarketSize {
  keyword: string;
  top10Revenue: number;
  top10Sales: number;
  top10AvgPrice: number;
  top40Revenue: number;
  top40Sales: number;
  top40AvgPrice: number;
}

/** JSON 트리 안에서 특정 키들을 가진 객체 모두 찾기 (재귀) */
function findInTree(obj: unknown, predicate: (o: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    const o = v as Record<string, unknown>;
    if (predicate(o)) out.push(o);
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(obj);
  return out;
}

/** "98,163만원" 같은 한국 표기 → 숫자(원) */
function parseKoNumber(s: string | number | undefined): number {
  if (typeof s === "number") return s;
  if (!s) return 0;
  const t = String(s).replace(/\s+/g, "");
  const m = t.match(/^([\d,.]+)(억|만|천|만원|억원)?원?$/);
  if (!m) return Number(t.replace(/[^\d.-]/g, "")) || 0;
  const n = Number(m[1].replace(/,/g, "")) || 0;
  switch (m[2]) {
    case "억":
    case "억원": return n * 100_000_000;
    case "만":
    case "만원": return n * 10_000;
    case "천": return n * 1_000;
  }
  return n;
}

async function fetchKeywordMarketSize(keyword: string): Promise<MarketSize | null> {
  const url = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}&pagingSize=40`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      Referer: "https://shopping.naver.com/",
    },
  });
  if (!res.ok) {
    console.warn(`  [${keyword}] HTTP ${res.status}`);
    return null;
  }
  const html = await res.text();

  // __NEXT_DATA__ 추출
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nextMatch) {
    // 다른 패턴 시도: window.__APOLLO_STATE__ 또는 인라인 JSON
    const apMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*({[\s\S]*?});/);
    if (!apMatch) {
      console.warn(`  [${keyword}] __NEXT_DATA__/__APOLLO_STATE__ 못 찾음`);
      return null;
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(nextMatch![1]);
  } catch (err) {
    console.warn(`  [${keyword}] JSON 파싱 실패`);
    return null;
  }

  // top10/40 통계 들어있는 객체 찾기
  // 네이버 쇼핑 페이지는 「naverPay」 또는 「mallType」 으로 식별되는 통계 객체를 가짐
  // 실제 키 이름은 사이트 변경에 따라 다를 수 있음 — 여러 후보 검사
  const candidates = findInTree(parsed, (o) => {
    return (
      ("top10TotalSale" in o || "top10Revenue" in o || "top10TotalAmount" in o) ||
      ("top10TotalSalesAmount" in o) ||
      ("naverPayTop10" in o)
    );
  });

  if (candidates.length === 0) {
    // fallback: 텍스트 패턴으로 찾기
    const t10 = html.match(/top.{0,5}10[\s\S]{0,200}?매출[^\d]*([\d,.]+\s*(?:억|만)?\s*원)/i);
    if (t10) {
      const rev = parseKoNumber(t10[1]);
      return {
        keyword,
        top10Revenue: rev,
        top10Sales: 0,
        top10AvgPrice: 0,
        top40Revenue: 0,
        top40Sales: 0,
        top40AvgPrice: 0,
      };
    }
    console.warn(`  [${keyword}] 통계 객체 못 찾음 (페이지 구조 변경 가능성)`);
    return null;
  }

  // 첫 번째 후보 사용
  const stats = candidates[0];
  const get = (...keys: string[]): number => {
    for (const k of keys) {
      if (k in stats) return parseKoNumber(stats[k] as string | number);
    }
    return 0;
  };
  return {
    keyword,
    top10Revenue: get("top10TotalSale", "top10Revenue", "top10TotalAmount", "top10TotalSalesAmount"),
    top10Sales: get("top10TotalCount", "top10Sales", "top10TotalSalesCount"),
    top10AvgPrice: get("top10AveragePrice", "top10AvgPrice"),
    top40Revenue: get("top40TotalSale", "top40Revenue", "top40TotalAmount", "top40TotalSalesAmount"),
    top40Sales: get("top40TotalCount", "top40Sales", "top40TotalSalesCount"),
    top40AvgPrice: get("top40AveragePrice", "top40AvgPrice"),
  };
}

async function dumpMarketSize(creds: SheetCreds, limit = 200): Promise<void> {
  // 결과 시트 + 입력 시트 모두 먼저 만들기
  await ensureTab(creds, "시장조사_시장규모", [
    "수집일",
    "키워드",
    "Top10 매출(6개월)",
    "Top10 판매량(6개월)",
    "Top10 평균가",
    "Top40 매출(6개월)",
    "Top40 판매량(6개월)",
    "Top40 평균가",
  ]);
  await ensureTab(creds, "⭐시장조사_시장규모_추적", [
    "키워드 (여기에 시장규모 볼 키워드 입력)",
    "비고",
  ]);

  // 입력 시트에서 사장님이 입력한 키워드 읽기
  const inputRows = await readRange(creds, "⭐시장조사_시장규모_추적!A2:A10000");
  const keywords = inputRows
    .map((r) => String(r[0] ?? "").trim())
    .filter(Boolean)
    .slice(0, limit);

  if (keywords.length === 0) {
    console.log("⚠️ 「⭐시장조사_시장규모_추적」 시트의 A열에 키워드를 입력하세요.");
    throw new Error("「⭐시장조사_시장규모_추적」 비어있음 — A열에 키워드 입력 후 다시 실행");
  }

  console.log(`\n시장규모 수집 — ${keywords.length}개 키워드 (5초 간격, 차단 회피)`);

  const today = new Date().toISOString().slice(0, 10);
  const collected: (string | number)[][] = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < keywords.length; i++) {
    const kw = String(keywords[i]);
    process.stdout.write(`  [${i + 1}/${keywords.length}] ${kw}: `);
    try {
      const s = await fetchKeywordMarketSize(kw);
      if (s) {
        collected.push([
          today,
          s.keyword,
          s.top10Revenue,
          s.top10Sales,
          s.top10AvgPrice,
          s.top40Revenue,
          s.top40Sales,
          s.top40AvgPrice,
        ]);
        console.log(`Top10=${s.top10Revenue.toLocaleString()}원 / ${s.top10Sales}개`);
        success++;
      } else {
        console.log("실패 (페이지 파싱)");
        failed++;
      }
    } catch (err) {
      console.log(`실패: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
      failed++;
    }
    await sleep(5000); // 차단 회피
  }

  if (collected.length > 0) {
    // 매번 clear + 새로 작성 — 중복/잔존 데이터 차단
    await clearTabData(creds, "시장조사_시장규모", 2);
    await appendRows(creds, "시장조사_시장규모!A2", collected);
  }
  console.log(`\n✅ 시장규모: 성공 ${success} / 실패 ${failed} / 시트 ${collected.length}행 (clear 후 새로)`);
  if (failed > success) {
    console.log("⚠️ 실패가 많아요. Naver 페이지 구조가 바뀌었을 수 있음. 로그 확인 + 코드 업데이트 필요.");
  }
}

// ─────────────────── 순위 추적 (네이버 쇼핑 검색 API 공식)

interface ShopItem {
  title: string;
  link: string;
  image: string;
  lprice: string;
  hprice: string;
  mallName: string;
  productId: string;
  productType: string;
  brand: string;
  maker: string;
  category1: string;
  category2: string;
  category3: string;
  category4: string;
}

let shopSearchDebugLogged = false;

async function fetchShoppingSearch(keyword: string, maxRank = 200): Promise<ShopItem[]> {
  if (!DEV_CLIENT_ID || !DEV_CLIENT_SECRET) {
    throw new Error("NAVER_DEVELOPER_CLIENT_ID/SECRET 없음");
  }
  const all: ShopItem[] = [];
  for (let start = 1; start <= maxRank; start += 100) {
    const display = Math.min(100, maxRank - start + 1);
    const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=${display}&start=${start}&sort=sim`;
    const res = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": DEV_CLIENT_ID,
        "X-Naver-Client-Secret": DEV_CLIENT_SECRET,
      },
    });
    if (!res.ok) {
      console.warn(`shopping search ${res.status}: ${(await res.text()).slice(0, 120)}`);
      break;
    }
    const data = (await res.json()) as { items?: ShopItem[]; total?: number };
    const items = data.items ?? [];
    // 진단: 첫 검색의 상위 5개 raw 출력 (productId 매칭 확인용)
    if (!shopSearchDebugLogged && items.length > 0) {
      shopSearchDebugLogged = true;
      console.log(`\n[진단6] 「${keyword}」 검색 상위 5개 raw:`);
      for (let i = 0; i < Math.min(5, items.length); i++) {
        const it = items[i];
        console.log(`  ${i + 1}. productId=${it.productId} | productType=${it.productType} | mall=${it.mallName} | title=${it.title?.replace(/<[^>]+>/g, "").slice(0, 60)}`);
        console.log(`     link=${it.link}`);
      }
      console.log(`[진단6] 끝\n`);
    }
    all.push(...items);
    if (items.length < 100) break;
    await sleep(200);
  }
  return all;
}

async function dumpRankTracking(creds: SheetCreds, maxRank = 200): Promise<void> {
  // 입력 시트 + 결과 시트 모두 항상 먼저 만들기
  await ensureTab(creds, "⭐순위추적_상품", ["productId", "라벨", "추적키워드 (콤마구분)"]);
  await ensureTab(creds, "순위추적_데이터", [
    "수집일",
    "키워드",
    "productId",
    "라벨",
    "순위",
    "전체결과수",
  ]);

  const productRows = await readRange(creds, "⭐순위추적_상품!A2:C10000");
  const targets = productRows
    .filter((r) => r[0] && r[2])
    .map((r) => ({
      productId: String(r[0]).trim(),
      label: String(r[1] ?? "").trim(),
      keywords: String(r[2]).split(",").map((k) => k.trim()).filter(Boolean),
    }));
  if (targets.length === 0) {
    console.log("⚠️ 「⭐순위추적_상품」 비어있음. productId/라벨/추적키워드 입력 후 재실행.");
    throw new Error("「⭐순위추적_상품」 비어있음 — productId/라벨/추적키워드(콤마구분) 입력 후 다시 실행");
  }

  // 키워드별로 묶어서 한 번씩만 조회 (효율)
  const keywordToProducts = new Map<string, { productId: string; label: string }[]>();
  for (const t of targets) {
    for (const kw of t.keywords) {
      const list = keywordToProducts.get(kw) ?? [];
      list.push({ productId: t.productId, label: t.label });
      keywordToProducts.set(kw, list);
    }
  }
  console.log(`\n순위추적 — ${keywordToProducts.size}개 키워드, ${targets.length}개 상품`);
  const today = new Date().toISOString().slice(0, 10);
  const collected: (string | number)[][] = [];

  for (const [kw, products] of keywordToProducts) {
    process.stdout.write(`  [${kw}] (${products.length}개 상품)… `);
    try {
      const items = await fetchShoppingSearch(kw, maxRank);
      console.log(`${items.length}개 결과`);
      for (const p of products) {
        const idx = items.findIndex((it) => it.productId === p.productId);
        const rank = idx >= 0 ? idx + 1 : 0;
        collected.push([today, kw, p.productId, p.label, rank, items.length]);
        console.log(`     ${p.label} → 순위 ${rank > 0 ? rank : "❌ 없음 (>" + maxRank + ")"}`);
      }
    } catch (err) {
      console.log(`실패: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`);
    }
    await sleep(400);
  }

  if (collected.length > 0) {
    // 매번 clear + 새로 작성 — 중복/잔존 데이터 차단
    await clearTabData(creds, "순위추적_데이터", 2);
    await appendRows(creds, "순위추적_데이터!A2", collected);
  }
  console.log(`\n✅ 순위추적: ${collected.length}건 (clear 후 새로 작성)`);
}

// ─────────────────── 메인

async function dumpCategoryTree(creds: SheetCreds): Promise<void> {
  console.log("[1/3] 카테고리 트리 수집…");

  // 결과 시트 미리 만들기 (없으면 생성, 있으면 헤더만 보장)
  await ensureTab(creds, "시장조사_카테고리", ["코드", "1차", "2차", "3차", "4차", "추적"]);

  // 기존 시트의 「추적」 (F열) 값 미리 읽어 보존 — 사장님이 'o' 표시한 거 안 지워지게
  const existing = await readRange(creds, "시장조사_카테고리!A2:F100000");
  const cidToTracked = new Map<string, string>();
  for (const row of existing) {
    const cid = String(row[0] ?? "").trim();
    const tracked = String(row[5] ?? "").trim();
    if (cid) cidToTracked.set(cid, tracked);
  }

  const tree = await fetchCategoryTree();
  console.log(`  → ${tree.length} 개 카테고리 (기존 추적 표시 ${[...cidToTracked.values()].filter(Boolean).length}개 보존)`);

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
      cidToTracked.get(n.cid) ?? "", // 추적 — 기존 값 보존 (없으면 빈 칸)
    ];
  });
  // 매번 시트 클리어 후 새로 작성 — 중복/잔존 데이터 차단 (추적 F열은 위에서 보존)
  await clearTabData(creds, "시장조사_카테고리", 2);
  await appendRows(creds, "시장조사_카테고리!A2", rows);
  console.log(`✅ 「시장조사_카테고리」 ${rows.length}행 (clear 후 새로 작성)`);
}

/** 입력 시트(⭐시장조사_키워드_추적) 에서 사장님이 입력한 카테고리 코드 읽기 */
async function fetchTrackedCategories(creds: SheetCreds): Promise<{ cid: string; name: string }[]> {
  // 입력 시트 자동 생성 (헤더 + 안내문)
  await ensureTab(creds, "⭐시장조사_키워드_추적", [
    "카테고리코드 (여기에 추적할 코드만 입력)",
    "카테고리명 (자동 채움)",
    "비고",
  ]);

  const inputRows = await readRange(creds, "⭐시장조사_키워드_추적!A2:A10000");
  const inputCids = inputRows
    .map((r) => String(r[0] ?? "").trim())
    .filter((c) => /^\d+$/.test(c));

  if (inputCids.length === 0) return [];

  // 카테고리명 매핑 — 「시장조사_카테고리」 시트 참조
  const catRows = await readRange(creds, "시장조사_카테고리!A2:E100000");
  const cidToName = new Map<string, string>();
  for (const row of catRows) {
    const cid = String(row[0] ?? "").trim();
    // 가장 깊은 (4차) 부터 우선
    const name = [row[4], row[3], row[2], row[1]].find((x) => x && String(x).trim()) || "";
    if (cid && name) cidToName.set(cid, String(name).trim());
  }

  // 입력 시트의 B열 (카테고리명 자동 채움) 갱신 — 사장님 편의
  try {
    for (let i = 0; i < inputCids.length; i++) {
      const cid = inputCids[i];
      const name = cidToName.get(cid) ?? "(시장조사_카테고리에 없음 — 트리 먼저 실행)";
      await writeRange(creds, `⭐시장조사_키워드_추적!B${i + 2}`, [[name]]);
    }
  } catch (e) {
    console.warn(`[키워드_추적 B열 갱신 실패 무시] ${e instanceof Error ? e.message : e}`);
  }

  return inputCids.map((cid) => ({ cid, name: cidToName.get(cid) ?? cid }));
}

async function dumpKeywordsForTrackedCategories(creds: SheetCreds): Promise<void> {
  // 결과 시트 + 입력 시트 모두 먼저 만들기
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

  const tracked = await fetchTrackedCategories(creds);
  if (tracked.length === 0) {
    console.log("\n⚠️ 「⭐시장조사_키워드_추적」 시트의 A열에 카테고리 코드를 입력하세요.");
    throw new Error("「⭐시장조사_키워드_추적」 비어있음 — A열에 카테고리 코드 입력 후 다시 실행 (시장조사_카테고리 시트 참조)");
  }
  console.log(`\n[2/3] 추적 ${tracked.length}개 카테고리 키워드 수집…`);

  const today = new Date().toISOString().slice(0, 10);
  const allRows: (string | number)[][] = []; // 모든 카테고리 결과 누적 (마지막에 한 번 clear+append)

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
            enrichedMap.set(row.relKeyword.toLowerCase(), row);
          }
        } catch (err) {
          console.warn(`    ad ${i}: ${err instanceof Error ? err.message : String(err)}`);
        }
        await sleep(300);
      }
    }

    for (const rk of ranked) {
      const ad = enrichedMap.get(rk.keyword.toLowerCase());
      const pc = num(ad?.monthlyPcQcCnt);
      const mb = num(ad?.monthlyMobileQcCnt);
      allRows.push([
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
      ]);
    }
    console.log(`    [${cat.name}] ${ranked.length}개 누적 (총 ${allRows.length})`);
    await sleep(1500);
  }

  // 모든 카테고리 처리 끝 — 한 번에 clear + append (중복/잔존 데이터 차단)
  if (allRows.length > 0) {
    await clearTabData(creds, "시장조사_키워드", 2);
    await appendRows(creds, "시장조사_키워드!A2", allRows);
    console.log(`✅ 「시장조사_키워드」 ${allRows.length}행 (clear 후 새로 작성)`);
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
  if (arg === "size") {
    await dumpMarketSize(SHEET_CREDS);
    return;
  }
  if (arg === "rank") {
    await dumpRankTracking(SHEET_CREDS);
    return;
  }
  console.log("\n✅ 완료");
  console.log("\n사용법:");
  console.log("  npx tsx market.ts          # 카테고리 트리 + 키워드 (둘 다)");
  console.log("  npx tsx market.ts tree     # 카테고리 트리만");
  console.log("  npx tsx market.ts keywords # 키워드만 (사장님 ✓ 표시한 카테고리)");
  console.log("  npx tsx market.ts size     # 시장규모 (Top40 매출/판매량)");
  console.log("  npx tsx market.ts rank     # 순위추적 (사장님 상품 → 키워드별 검색순위)");
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.cause) {
    console.error("CAUSE:", err.cause);
  }
  if (err instanceof Error && err.stack) {
    console.error("STACK:", err.stack.split("\n").slice(0, 5).join("\n"));
  }
  process.exit(1);
});
