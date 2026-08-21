import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAdminOrService, isNextResponse } from "@/lib/auth-guard";
import { normalizeProductKey } from "@/lib/utils";
import { ensureBundleTable } from "@/lib/ensure-bundle-table";

export const maxDuration = 300;

// 식약처 "의약품 묶음정보"(동일제조소 생산 동일성분 제네릭 묶음) 전량 동기화.
// sync/route.ts(허가정보)와 같은 배치 연속(startPage/batchSize/nextPage) 방식.
// 응답 필드명이 미검증 상태라 후보키 정규식으로 방어적으로 매핑하고 원본 행을 raw(JSONB)로 보관,
// 응답에 sampleKeys/mappingStats를 노출해 실서버에서 매핑 적중을 확인할 수 있게 한다.
const API_KEY = process.env.PUBLIC_DATA_API_KEY!;
const BASE_URL = "https://apis.data.go.kr/1471000/DrbBundleInfoService02/getDrbBundleList02";

const GEN_PENDING_KEY = "bundleSyncPendingGen";
const GEN_CURRENT_KEY = "bundleCurrentGen";
const LAST_SYNC_KEY = "lastBundleSync";

// 403(SERVICE_KEY_IS_NOT_REGISTERED) 진단용: 서버가 실제로 쓰는 키의 앞뒤 일부만 노출 (admin 전용 응답)
function keyHint(): string {
  if (!API_KEY) return "(PUBLIC_DATA_API_KEY 비어있음)";
  return `${API_KEY.slice(0, 6)}…${API_KEY.slice(-4)} (${API_KEY.length}자)`;
}

// 같은 키로 기존 허가정보 API가 살아있는지 1건 호출 — 키 자체 문제 vs 묶음 서비스 미등록 구분
async function probePermitApi(): Promise<string> {
  try {
    const url = new URL("https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07");
    url.searchParams.set("serviceKey", API_KEY);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "1");
    url.searchParams.set("type", "json");
    const res = await fetch(url.toString(), { cache: "no-store" });
    const text = await res.text();
    if (!res.ok) return `실패 (${res.status}): ${text.slice(0, 120)}`;
    return "정상";
  } catch (e) {
    return `실패: ${e instanceof Error ? e.message : String(e)}`;
  }
}

interface BundleRow { [key: string]: unknown }

async function fetchPage(pageNo: number): Promise<{ items: BundleRow[]; totalCount: number }> {
  const url = new URL(BASE_URL);
  url.searchParams.set("serviceKey", API_KEY);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("type", "json");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => "")}`);

  const json = await res.json();
  // body 위치/items 형태가 서비스마다 달라 방어적으로 파싱 (body | response.body, items | items.item, 배열 | 단일객체)
  const body = json?.body ?? json?.response?.body ?? {};
  const rawItems = body?.items?.item ?? body?.items ?? [];
  const items: BundleRow[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  return { items, totalCount: parseInt(body?.totalCount ?? "0") || 0 };
}

async function fetchPageWithRetry(pageNo: number, retries = 3): Promise<{ items: BundleRow[]; totalCount: number }> {
  let lastError: unknown = null;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchPage(pageNo);
    } catch (e) {
      lastError = e;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i)));
    }
  }
  throw new Error(`페이지 ${pageNo} 실패 (${retries}회 재시도): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/** 후보키 매핑: 정확한 키 → 패턴 매칭 키 순서로 첫 번째 비어있지 않은 문자열 값 반환 */
function pickField(item: BundleRow, exactKeys: string[], patterns: RegExp[], preferSuffix?: RegExp): string | null {
  const keys = Object.keys(item);
  const val = (k: string): string | null => {
    const v = item[k];
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  };
  for (const ek of exactKeys) {
    const k = keys.find((key) => key.toUpperCase() === ek.toUpperCase());
    if (k) {
      const v = val(k);
      if (v) return v;
    }
  }
  let matched = keys.filter((k) => patterns.some((p) => p.test(k)));
  if (preferSuffix) {
    const preferred = matched.filter((k) => preferSuffix.test(k));
    if (preferred.length > 0) matched = preferred;
  }
  for (const k of matched) {
    const v = val(k);
    if (v) return v;
  }
  return null;
}

interface MappedRow {
  id: string;
  groupKey: string;
  manufacturerName: string | null;
  itemName: string | null;
  entpName: string | null;
  ingredientName: string | null;
  itemSeq: string | null;
  productKey: string | null;
  rawJson: string;
}

function mapRow(item: BundleRow): MappedRow {
  const manufacturerName = pickField(item, ["MAKE_MTRAL_NM", "MNF_NM", "MANUF_NM", "MAKING_PLC", "MNF_PLC_NM"], [/MAKE|MAKING|MNF|MANUF|FCTR|FACTORY|PLC|MAKER|제조/i]);
  const itemName = pickField(item, ["ITEM_NAME", "PRDUCT_NM"], [/ITEM.*NAME|PRDT.*NAME|PRDUCT|품목명|제품명/i]);
  const entpName = pickField(item, ["ENTP_NAME", "ENTP_NM"], [/ENTP|업체/i]);
  const ingredientName = pickField(item, ["MAIN_INGR", "INGR_NAME", "MAIN_ITEM_INGR"], [/INGR|MAIN.*(ITEM|INGR)|성분/i]);
  const itemSeq = pickField(item, ["ITEM_SEQ"], [/ITEM_SEQ|품목기준/i]);
  const rawJson = JSON.stringify(item);

  // 묶음 그룹키: BNDL/GRP 계열 키 우선(번호/코드형 키 선호) → 대표품목코드 계열(묶음의약품정보서비스는
  // 대표품목 기준으로 묶임) → 실패 시 제조소+성분 조합 → 그것도 없으면 UNKNOWN 격리
  let groupKey = pickField(item, ["BNDL_NO", "BNDL_SEQ", "GRP_NO", "BUNDLE_NO"], [/BNDL|BUNDLE|GROUP|GRP|묶음/i], /(NO|SEQ|CD|ID)$/i);
  if (!groupKey) {
    groupKey = pickField(item, [], [/RPRSNT|REPRESENT|대표/i], /(NO|SEQ|CD|ID)$/i);
  }
  if (!groupKey) {
    if (manufacturerName && ingredientName) groupKey = `${manufacturerName}|${ingredientName}`;
    else groupKey = "UNKNOWN:" + createHash("sha1").update(rawJson).digest("hex").slice(0, 12);
  }

  const productKey = itemName ? normalizeProductKey(itemName) || null : null;
  const idTail = itemSeq || productKey || createHash("sha1").update(rawJson).digest("hex").slice(0, 12);
  return {
    id: `${groupKey}|${idTail}`,
    groupKey,
    manufacturerName,
    itemName,
    entpName,
    ingredientName,
    itemSeq,
    productKey,
    rawJson,
  };
}

function isTransientDbError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /max clients|EMAXCONN|connection|ECONNREFUSED|ETIMEDOUT|pool/i.test(msg);
}

async function withDbRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isTransientDbError(e) || i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 600 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

interface MappingStats { groupKey: number; manufacturer: number; itemName: number; unmappedGroup: number }

async function processPage(pageItems: BundleRow[], generation: string, stats: MappingStats): Promise<number> {
  // 배치 내 중복 id 제거 — 같은 INSERT문에서 동일 행을 두 번 건드리면
  // "ON CONFLICT DO UPDATE command cannot affect row a second time"로 배치 전체가 실패함
  const byId = new Map<string, MappedRow>();
  for (const item of pageItems) {
    const row = mapRow(item);
    byId.set(row.id, row);
    if (!row.groupKey.startsWith("UNKNOWN:")) stats.groupKey++;
    else stats.unmappedGroup++;
    if (row.manufacturerName) stats.manufacturer++;
    if (row.itemName) stats.itemName++;
  }
  const rows = Array.from(byId.values());
  if (rows.length === 0) return 0;

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const tuples: string[] = [];
    const params: (string | null)[] = [];
    let p = 1;
    for (const r of slice) {
      tuples.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::jsonb, $${p++}, NOW())`);
      params.push(r.id, r.groupKey, r.manufacturerName, r.itemName, r.entpName, r.ingredientName, r.itemSeq, r.productKey, r.rawJson, generation);
    }
    const sql = `
      INSERT INTO "MfdsBundleItem"
        ("id", "groupKey", "manufacturerName", "itemName", "entpName", "ingredientName", "itemSeq", "productKey", "raw", "generation", "syncedAt")
      VALUES ${tuples.join(", ")}
      ON CONFLICT ("id") DO UPDATE SET
        "groupKey" = EXCLUDED."groupKey",
        "manufacturerName" = EXCLUDED."manufacturerName",
        "itemName" = EXCLUDED."itemName",
        "entpName" = EXCLUDED."entpName",
        "ingredientName" = EXCLUDED."ingredientName",
        "itemSeq" = EXCLUDED."itemSeq",
        "productKey" = EXCLUDED."productKey",
        "raw" = EXCLUDED."raw",
        "generation" = EXCLUDED."generation",
        "syncedAt" = NOW()
    `;
    await withDbRetry(() => prisma.$executeRawUnsafe(sql, ...params));
  }
  return rows.length;
}

async function getSetting(key: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "SystemSetting" WHERE "key" = ${key}
  `.catch(() => [] as { value: string }[]);
  return rows[0]?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = ${value}, "updatedAt" = NOW()
  `;
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrService(req);
  if (isNextResponse(guard)) return guard;
  const body = await req.json().catch(() => ({}));
  const testMode = body?.mode === "test";
  const startPage = Math.max(1, parseInt(body?.startPage) || 1);
  const rawBatch = parseInt(body?.batchSize);
  const batchSize = testMode ? 1 : Math.max(1, Math.min(50, Number.isFinite(rawBatch) ? rawBatch : 20));

  const pageErrors: { page: number; error: string }[] = [];
  const stats: MappingStats = { groupKey: 0, manufacturer: 0, itemName: 0, unmappedGroup: 0 };
  let synced = 0;
  let totalPages = 0;
  let totalCount = 0;
  let endPage = startPage;
  let sampleKeys: string[] = [];

  try {
    await ensureBundleTable();

    // 세대 태그: 1페이지부터 시작하는 동기화가 새 세대를 연다. 이어받는 배치는 pendingGen을 사용.
    let generation: string;
    if (startPage === 1) {
      generation = Date.now().toString(36);
      if (!testMode) await setSetting(GEN_PENDING_KEY, generation);
    } else {
      const pending = await getSetting(GEN_PENDING_KEY);
      if (!pending) {
        return NextResponse.json({ error: "진행 중인 동기화 세대가 없어요. startPage=1부터 시작해주세요." }, { status: 400 });
      }
      generation = pending;
    }

    const first = await fetchPageWithRetry(startPage);
    totalCount = first.totalCount;
    sampleKeys = Object.keys(first.items[0] ?? {});
    if (totalCount === 0) {
      return NextResponse.json({
        error: "공공 API에서 데이터를 가져오지 못했어요. API 키를 확인해주세요.",
        sampleKeys,
      }, { status: 502 });
    }
    totalPages = Math.ceil(totalCount / 100);
    endPage = Math.min(startPage + batchSize - 1, totalPages);

    try {
      synced += await processPage(first.items, testMode ? `test-${generation}` : generation, stats);
    } catch (e) {
      pageErrors.push({ page: startPage, error: e instanceof Error ? e.message : String(e) });
    }

    if (!testMode) {
      // 순차 처리 (pg pool max=1 — 병렬 금지)
      for (let p = startPage + 1; p <= endPage; p++) {
        try {
          const { items } = await fetchPageWithRetry(p);
          synced += await processPage(items, generation, stats);
        } catch (e) {
          pageErrors.push({ page: p, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    const done = !testMode && endPage >= totalPages;
    if (done) {
      // 세대 교체: 조회 기준을 새 세대로 바꾼 뒤 구세대(및 중단된 과거 세대 잔여분) 삭제
      await setSetting(GEN_CURRENT_KEY, generation);
      await prisma.$executeRaw`DELETE FROM "MfdsBundleItem" WHERE "generation" <> ${generation}`;
      await setSetting(LAST_SYNC_KEY, new Date().toISOString());
    }
    if (testMode) {
      // 테스트 행은 조회 세대에 안 걸리지만 바로 청소
      await prisma.$executeRaw`DELETE FROM "MfdsBundleItem" WHERE "generation" = ${"test-" + generation}`.catch(() => null);
    }

    return NextResponse.json({
      success: true,
      synced,
      startPage,
      endPage,
      nextPage: done || testMode ? null : endPage + 1,
      totalPages,
      totalCount,
      done,
      sampleKeys,
      mappingStats: stats,
      pageErrors: pageErrors.length > 0 ? pageErrors : undefined,
    });
  } catch (err) {
    // 묶음 API 실패 시 같은 키로 허가정보 API를 1건 찔러 키 문제/서비스 미등록을 구분해준다
    const permitApi = await probePermitApi();
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      startPage,
      endPage,
      synced,
      sampleKeys,
      serverKey: keyHint(),
      permitApi: `허가정보 API(기존 ③번): ${permitApi}`,
      pageErrors: pageErrors.length > 0 ? pageErrors : undefined,
    }, { status: 500 });
  }
}

export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  await ensureBundleTable();
  const currentGen = await getSetting(GEN_CURRENT_KEY);
  const lastSync = await getSetting(LAST_SYNC_KEY);
  const countRows = currentGen
    ? await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM "MfdsBundleItem" WHERE "generation" = ${currentGen}
      `.catch(() => [{ count: BigInt(0) }])
    : [{ count: BigInt(0) }];
  return NextResponse.json({
    count: Number(countRows[0]?.count ?? 0),
    currentGen,
    lastSync,
  });
}
