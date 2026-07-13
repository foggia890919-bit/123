import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ALL_ADAPTERS, DISABLED_SITES } from "@/scrapers/adapters";

// 재고 다리 — 라이브 재확인 라우트 (약국몰이 PULL, read-only 아님: 워커 실크롤 트리거).
//
// 청크1(bridge-export)이 스냅샷을 읽기만 하는 것과 달리, 이 라우트는 워커에
// 실시간 크롤을 요청해 "지금 이 순간" 재고를 확인한다. 주문 접수 직후 fire-and-forget
// 로 주문 품목(≤20)만 재확인하는 용도.
//
// 인증: Bearer YK_BRIDGE_TOKEN (양쪽 Vercel env 동일, 상수시간 비교).
// 계약 응답: { ok:true, results: { [insuranceCode]: { stock, unitPrice, scrapedAt, confirmed } } }
//   - confirmed=true  → 워커가 그 코드를 실제로 조회해 값을 읽음 (품절이면 stock:0, confirmed:true)
//   - confirmed=false → 워커 불가/조회 실패/무결과(재시도 후에도 결과 없음). stock:null.
// 호출측이 "품절 확정(문자 발송)"과 "확인 불가(미발송+관리자 플래그)"를 구분해야 하므로
// 워커가 통째로 불가여도 500/ok:false 가 아니라 각 코드 confirmed:false 로 200 응답한다.

export const maxDuration = 300;

const MAX_CODES = 20;
const CODE_RE = /^\d{9,12}$/;

interface LiveResult {
  stock: number | null;
  unitPrice: number | null;
  scrapedAt: string | null;
  confirmed: boolean;
}

// 워커 /scrape 응답 행. worker/src/server.ts 의 ScrapeRow 와 동형.
interface ScrapeRow {
  siteKey: string;
  insuranceCode: string;
  items: Array<{
    insuranceCode?: string;
    productName?: string | null;
    spec?: string | null;
    manufacturer?: string | null;
    unitPrice?: number | null;
    stock?: number | null;
  }>;
  error?: string;
  scrapedAt?: string;
}

function isNetworkError(msg: string): boolean {
  return (
    msg === "fetch failed" ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("UND_ERR") ||
    msg.includes("TimeoutError") ||
    msg.includes("The operation was aborted") ||
    msg.includes("network")
  );
}

// 상수시간 토큰 비교 (청크1 bridge-export 와 동일 방식).
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // 길이 불일치는 즉시 실패 (동길이 입력엔 상수시간)
  return timingSafeEqual(a, b);
}

function allUnconfirmed(codes: string[]): Record<string, LiveResult> {
  const out: Record<string, LiveResult> = {};
  for (const c of codes) out[c] = { stock: null, unitPrice: null, scrapedAt: null, confirmed: false };
  return out;
}

export async function POST(req: NextRequest) {
  // --- 인증 ---
  const expected = process.env.YK_BRIDGE_TOKEN;
  if (!expected) {
    // env 미설정 → 다리 비활성. 호출측이 폴백하도록 503.
    return NextResponse.json(
      { ok: false, error: "bridge token (YK_BRIDGE_TOKEN) not configured" },
      { status: 503 }
    );
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = m?.[1] ?? "";
  if (!token || !tokensMatch(token, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // --- body ---
  let body: { codes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  let codes = Array.isArray(body.codes)
    ? body.codes.filter((c): c is string => typeof c === "string" && CODE_RE.test(c))
    : [];
  codes = Array.from(new Set(codes)); // 중복 제거
  if (codes.length === 0) {
    return NextResponse.json(
      { ok: false, error: "codes (string[]) required — 9~12 digit insurance codes" },
      { status: 400 }
    );
  }

  let warning: string | undefined;
  if (codes.length > MAX_CODES) {
    warning = `codes truncated to first ${MAX_CODES} (received ${codes.length})`;
    codes = codes.slice(0, MAX_CODES);
  }

  // 기본 사이트 = 활성(ALL_ADAPTERS) && !비활성(DISABLED_SITES).
  // 현재 [ibjp, family] (inchun 은 DISABLED). 추후 인천 편입 시 자동 포함.
  // 배열 순서(ibjp before family)를 병합 tie-break 우선순위로도 사용.
  const sites = Object.keys(ALL_ADAPTERS).filter(k => !DISABLED_SITES.has(k));

  // --- 워커 프리플라이트 + /scrape 프록시 ---
  // 어떤 단계에서든 워커가 불가하면 "확인 불가" 로 간주해 모든 코드 confirmed:false 로 200 응답.
  const workerUrl = process.env.WORKER_URL;
  const workerToken = process.env.WORKER_TOKEN;
  if (!workerUrl || !workerToken) {
    return NextResponse.json({
      ok: true,
      results: allUnconfirmed(codes),
      workerConfigured: false,
      ...(warning ? { warning } : {}),
    });
  }
  const base = workerUrl.replace(/\/$/, "");

  // 프리플라이트: /health 로 5초 내 도달 확인. 실패 시 즉시 전량 confirmed:false.
  try {
    const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!health.ok) {
      return NextResponse.json({
        ok: true,
        results: allUnconfirmed(codes),
        workerReachable: false,
        note: `worker health HTTP ${health.status}`,
        ...(warning ? { warning } : {}),
      });
    }
  } catch (healthErr) {
    const hmsg = (healthErr as Error).message ?? "";
    return NextResponse.json({
      ok: true,
      results: allUnconfirmed(codes),
      workerReachable: false,
      note: isNetworkError(hmsg) ? "worker unreachable" : `worker health error: ${hmsg}`,
      ...(warning ? { warning } : {}),
    });
  }

  // /scrape — 워커가 사이트별로 실크롤. 최대 280초.
  let rows: ScrapeRow[] = [];
  try {
    const r = await fetch(`${base}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({ sites, codes }),
      signal: AbortSignal.timeout(280_000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return NextResponse.json({
        ok: true,
        results: allUnconfirmed(codes),
        workerReachable: true,
        note: `worker /scrape HTTP ${r.status}: ${text.slice(0, 200)}`,
        ...(warning ? { warning } : {}),
      });
    }
    const data = await r.json();
    rows = Array.isArray(data?.results) ? (data.results as ScrapeRow[]) : [];
  } catch (scrapeErr) {
    const smsg = (scrapeErr as Error).message ?? "";
    return NextResponse.json({
      ok: true,
      results: allUnconfirmed(codes),
      workerReachable: true,
      note: isNetworkError(smsg) ? "worker /scrape timed out or dropped" : `worker /scrape error: ${smsg}`,
      ...(warning ? { warning } : {}),
    });
  }

  // --- 스냅샷 upsert (check/route.ts 와 동일 방식: 이후 스냅샷 경로가 재크롤 없이 최신값 확인) ---
  await persistSnapshots(rows);

  // --- 코드별 병합 (single-source) + confirmed 판정 ---
  const results: Record<string, LiveResult> = {};
  for (const code of codes) {
    results[code] = mergeForCode(code, rows, sites);
  }

  return NextResponse.json({
    ok: true,
    results,
    source: "live",
    ...(warning ? { warning } : {}),
  });
}

// 한 사이트/코드가 여러 규격 행을 반환할 수 있으므로 (siteKey,insuranceCode) 단위로
// stock 합산·unitPrice 첫값 집계 후 upsert. check/route.ts 의 "cannot affect row a
// second time" 회피 로직과 동일.
async function persistSnapshots(rows: ScrapeRow[]): Promise<void> {
  const aggMap = new Map<string, {
    siteKey: string;
    insuranceCode: string;
    productName: string | null;
    spec: string | null;
    manufacturer: string | null;
    unitPrice: number | null;
    stock: number | null;
  }>();

  for (const row of rows) {
    if (!row || row.error || !row.siteKey || !row.insuranceCode || !Array.isArray(row.items)) continue;
    for (const item of row.items) {
      const key = `${row.siteKey}|${row.insuranceCode}`;
      const cur = aggMap.get(key);
      const s = {
        siteKey: row.siteKey,
        insuranceCode: row.insuranceCode,
        productName: item.productName ?? null,
        spec: item.spec ?? null,
        manufacturer: item.manufacturer ?? null,
        unitPrice: item.unitPrice ?? null,
        stock: item.stock ?? null,
      };
      if (!cur) {
        aggMap.set(key, s);
      } else {
        cur.stock = cur.stock != null && s.stock != null ? cur.stock + s.stock : cur.stock ?? s.stock;
        if (cur.unitPrice == null && s.unitPrice != null) cur.unitPrice = s.unitPrice;
        if (cur.productName == null && s.productName != null) cur.productName = s.productName;
      }
    }
  }

  const aggregated = Array.from(aggMap.values());
  if (aggregated.length === 0) return;

  await Promise.all(aggregated.map(async (s) => {
    try {
      await prisma.inventorySnapshot.upsert({
        where: { siteKey_insuranceCode: { siteKey: s.siteKey, insuranceCode: s.insuranceCode } },
        update: {
          productName: s.productName,
          spec: s.spec,
          manufacturer: s.manufacturer,
          unitPrice: s.unitPrice,
          stock: s.stock,
          scrapedAt: new Date(),
        },
        create: {
          siteKey: s.siteKey,
          insuranceCode: s.insuranceCode,
          productName: s.productName,
          spec: s.spec,
          manufacturer: s.manufacturer,
          unitPrice: s.unitPrice,
          stock: s.stock,
        },
      });
    } catch (err) {
      console.error(`[inventory/bridge-live] upsert failed — ${s.siteKey}/${s.insuranceCode}: ${(err as Error).message}`);
    }
  }));
}

interface SiteAgg {
  siteKey: string;
  stock: number | null;
  unitPrice: number | null;
  scrapedAt: string;
}

// single-source 병합 + confirmed 판정.
//   confirmed = 어떤 사이트든 error 없이 items 를 실제로 읽었을 때 true.
//     (worker 는 무결과 시 1회 재시도하므로 items.length>0 = 실제 값 읽음.
//      진짜 품절은 items 있고 stock=0 → confirmed:true, stock:0)
//   무결과/에러뿐 = confirmed:false, stock:null.
//   재고>0 사이트 중 unitPrice 최저 1곳 선택 → 동가면 재고 많은쪽 → sites 배열 순서(ibjp>family).
//   전부 0/null(확인은 됨) = stock 0 (품절 확정), 참고가로 최저 unitPrice.
function mergeForCode(code: string, rows: ScrapeRow[], sitePriority: string[]): LiveResult {
  const perSite = new Map<string, SiteAgg>();

  for (const row of rows) {
    if (!row || row.insuranceCode !== code) continue;
    if (row.error || !Array.isArray(row.items) || row.items.length === 0) continue; // 에러/무결과 = 미확인

    const cur = perSite.get(row.siteKey);
    let stock: number | null = cur?.stock ?? null;
    let unitPrice: number | null = cur?.unitPrice ?? null;
    for (const item of row.items) {
      if (item.stock != null) stock = (stock ?? 0) + item.stock;
      if (unitPrice == null && item.unitPrice != null) unitPrice = item.unitPrice;
    }
    perSite.set(row.siteKey, {
      siteKey: row.siteKey,
      stock,
      unitPrice,
      scrapedAt: row.scrapedAt ?? cur?.scrapedAt ?? new Date().toISOString(),
    });
  }

  // 어떤 사이트도 실제 값을 못 읽음 → 확인 불가.
  if (perSite.size === 0) {
    return { stock: null, unitPrice: null, scrapedAt: null, confirmed: false };
  }

  const priorityIdx = (k: string) => {
    const i = sitePriority.indexOf(k);
    return i < 0 ? 999 : i;
  };
  const priceKey = (v: SiteAgg) => (v.unitPrice == null ? Number.POSITIVE_INFINITY : v.unitPrice);

  const entries = Array.from(perSite.values());
  const positive = entries.filter(v => v.stock != null && v.stock > 0);

  if (positive.length > 0) {
    positive.sort((a, b) => {
      const pa = priceKey(a), pb = priceKey(b);
      if (pa !== pb) return pa - pb;                         // 최저 매입가
      const sa = a.stock ?? 0, sb = b.stock ?? 0;
      if (sa !== sb) return sb - sa;                         // 동가면 재고 많은쪽
      return priorityIdx(a.siteKey) - priorityIdx(b.siteKey); // 그다음 ibjp>family
    });
    const chosen = positive[0];
    return { stock: chosen.stock, unitPrice: chosen.unitPrice, scrapedAt: chosen.scrapedAt, confirmed: true };
  }

  // 확인은 됐지만 재고>0 사이트가 없음 → 품절 확정(stock 0). 참고가는 최저 unitPrice.
  const ref = entries.slice().sort((a, b) => {
    const pa = priceKey(a), pb = priceKey(b);
    if (pa !== pb) return pa - pb;
    return priorityIdx(a.siteKey) - priorityIdx(b.siteKey);
  })[0];
  return { stock: 0, unitPrice: ref.unitPrice, scrapedAt: ref.scrapedAt, confirmed: true };
}
