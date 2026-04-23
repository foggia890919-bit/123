import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export const maxDuration = 300;

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;
// 건강보험심사평가원_약가마스터_의약품주성분
const BASE_URL = "https://apis.data.go.kr/B551182/msupplyIngdDtlService/getMsupplyIngdDtlService";

interface HiraDrug { [key: string]: string | undefined; }

async function fetchPage(pageNo: number): Promise<{ items: HiraDrug[]; totalCount: number }> {
  const url = new URL(BASE_URL);
  url.searchParams.set("serviceKey", API_KEY);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("type", "json");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`HIRA API ${res.status}: ${await res.text().catch(() => "")}`);

  const json = await res.json();
  // HIRA API 응답 구조: { body: { items: [...], totalCount: "N" } }
  // 또는: { response: { body: { items: [...], totalCount: N } } }
  const body = json?.body ?? json?.response?.body;
  if (!body) throw new Error(`응답 구조 불명: ${JSON.stringify(json).slice(0, 300)}`);

  const rawItems = body?.items ?? body?.item ?? [];
  const items: HiraDrug[] = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
  const totalCount = parseInt(String(body?.totalCount ?? body?.total_count ?? "0"));
  return { items, totalCount };
}

async function fetchPageWithRetry(pageNo: number, retries = 3): Promise<{ items: HiraDrug[]; totalCount: number }> {
  let lastError: unknown = null;
  for (let i = 0; i < retries; i++) {
    try { return await fetchPage(pageNo); } catch (e) {
      lastError = e;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i)));
    }
  }
  throw new Error(`페이지 ${pageNo} 실패: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function mapDrug(item: HiraDrug) {
  // HIRA 약가마스터_의약품주성분 필드명 (실제 응답 확인 후 조정)
  // 공통 필드명 후보들을 순서대로 시도
  const productName = (
    item["품목명"] ?? item["제품명"] ?? item["ITEM_NAME"] ?? item["itemName"] ?? ""
  ).trim();
  const companyName = (
    item["업체명"] ?? item["제조사명"] ?? item["ENTP_NAME"] ?? item["entpName"] ?? "미상"
  ).trim();
  const ingredientName = (
    item["주성분명"] ?? item["성분명"] ?? item["INGD_NM"] ?? item["ingdNm"] ?? item["주성분"] ?? ""
  ).trim();
  const insuranceCode = (
    item["급여코드"] ?? item["보험코드"] ?? item["EDI_CODE"] ?? item["ediCode"] ?? item["품목기준코드"] ?? ""
  ).trim() || null;
  const priceRaw = parseInt(
    item["상한금액"] ?? item["약가"] ?? item["MAX_PRICE"] ?? item["maxPrice"] ?? ""
  );
  const price = isNaN(priceRaw) ? null : priceRaw;

  return {
    categoryA: null as string | null,
    ingredientName: ingredientName || productName,
    categoryB: null as string | null,
    companyName: companyName || "미상",
    productName,
    price,
    insuranceCode,
    bioStatus: null as string | null,
    originalDrug: null as string | null,
    notes: null as string | null,
    isSettlement: false,
    commissionRate: null as number | null,
    source: "PUBLIC_API" as const,
    updatedAt: new Date(),
  };
}

function isTransientDbError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /max clients|EMAXCONN|connection|ECONNREFUSED|ETIMEDOUT|pool/i.test(msg);
}

async function withDbRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (!isTransientDbError(e) || i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 600 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

async function processPage(pageItems: HiraDrug[]): Promise<number> {
  const drugs = pageItems.map(mapDrug).filter((d) => d.productName && d.companyName);
  if (drugs.length === 0) return 0;

  const codes = drugs.map((d) => d.insuranceCode).filter(Boolean) as string[];
  const existing = codes.length > 0
    ? await withDbRetry(() => prisma.medication.findMany({
        where: { insuranceCode: { in: codes } },
        select: { id: true, insuranceCode: true },
      }))
    : [];
  const existingMap = new Map(existing.map((e) => [e.insuranceCode, e]));

  const toCreate: typeof drugs = [];
  const toUpdate: { id: string; data: Partial<ReturnType<typeof mapDrug>> }[] = [];

  for (const drug of drugs) {
    const found = drug.insuranceCode ? existingMap.get(drug.insuranceCode) : null;
    if (found) {
      toUpdate.push({
        id: found.id,
        data: {
          productName: drug.productName,
          ingredientName: drug.ingredientName,
          companyName: drug.companyName,
          price: drug.price,
          updatedAt: new Date(),
        },
      });
    } else {
      toCreate.push(drug);
    }
  }

  if (toCreate.length > 0) {
    await withDbRetry(() => prisma.medication.createMany({ data: toCreate, skipDuplicates: true }));
  }

  if (toUpdate.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < toUpdate.length; i += CHUNK) {
      const slice = toUpdate.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: (string | number | null)[] = [];
      let p = 1;
      for (const { id, data } of slice) {
        tuples.push(`($${p++}::text, $${p++}::text, $${p++}::text, $${p++}::text, $${p++}::int)`);
        params.push(id, data.productName ?? "", data.ingredientName ?? "", data.companyName ?? "", data.price ?? null);
      }
      await withDbRetry(() => prisma.$executeRawUnsafe(`
        UPDATE "Medication" AS m
        SET "productName" = v.pn, "ingredientName" = v.ing, "companyName" = v.cn,
            "price" = v.price, "updatedAt" = NOW()
        FROM (VALUES ${tuples.join(", ")}) AS v(id, pn, ing, cn, price)
        WHERE m.id = v.id
      `, ...params));
    }
  }

  return drugs.length;
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const body = await req.json().catch(() => ({}));
  const testMode = body?.mode === "test";
  const startPage = Math.max(1, parseInt(body?.startPage) || 1);
  const batchSize = testMode ? 1 : Math.max(1, Math.min(30, parseInt(body?.batchSize) || 10));

  const pageErrors: { page: number; error: string }[] = [];
  let synced = 0, totalPages = 0, totalCount = 0, endPage = startPage;

  try {
    const first = await fetchPageWithRetry(startPage);
    totalCount = first.totalCount;
    if (totalCount === 0) {
      return NextResponse.json({ error: "HIRA API에서 데이터를 가져오지 못했어요. 키 활성화 여부를 확인해주세요." }, { status: 502 });
    }
    totalPages = Math.ceil(totalCount / 100);
    endPage = Math.min(startPage + batchSize - 1, totalPages);

    try { synced += await processPage(first.items); } catch (e) {
      pageErrors.push({ page: startPage, error: e instanceof Error ? e.message : String(e) });
    }

    for (let p = startPage + 1; p <= endPage; p++) {
      try { const { items } = await fetchPageWithRetry(p); synced += await processPage(items); } catch (e) {
        pageErrors.push({ page: p, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const done = !testMode && endPage >= totalPages;
    const now = new Date().toISOString();
    if (done) {
      await prisma.$executeRaw`
        INSERT INTO "SystemSetting" ("key", "value", "updatedAt") VALUES ('lastHiraSync', ${now}, NOW())
        ON CONFLICT ("key") DO UPDATE SET "value" = ${now}, "updatedAt" = NOW()
      `.catch(() => null);
    }

    const [publicCount, excelCount] = await Promise.all([
      prisma.medication.count({ where: { source: "PUBLIC_API" } }),
      prisma.medication.count({ where: { source: "EXCEL" } }),
    ]);

    return NextResponse.json({
      success: true, synced, startPage, endPage,
      nextPage: done ? null : endPage + 1,
      totalPages, totalCount, done, publicCount, excelCount,
      pageErrors: pageErrors.length > 0 ? pageErrors : undefined,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      startPage, endPage, synced,
      pageErrors: pageErrors.length > 0 ? pageErrors : undefined,
    }, { status: 500 });
  }
}

export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const [publicCount, excelCount, syncRows] = await Promise.all([
    prisma.medication.count({ where: { source: "PUBLIC_API" } }),
    prisma.medication.count({ where: { source: "EXCEL" } }),
    prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT "key", "value" FROM "SystemSetting" WHERE "key" = 'lastHiraSync'
    `.catch(() => [] as { key: string; value: string }[]),
  ]);
  const syncMap = Object.fromEntries(syncRows.map((r) => [r.key, r.value]));
  return NextResponse.json({ publicCount, excelCount, total: publicCount + excelCount, lastSync: syncMap.lastHiraSync ?? null });
}
