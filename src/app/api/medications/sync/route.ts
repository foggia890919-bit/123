import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;
const BASE_URL = "https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07";

interface PublicDrug { [key: string]: string | undefined; }

async function fetchPage(pageNo: number): Promise<{ items: PublicDrug[]; totalCount: number }> {
  const url = new URL(BASE_URL);
  url.searchParams.set("serviceKey", API_KEY);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("type", "json");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => "")}`);

  const json = await res.json();
  const body = json?.body;
  const rawItems = body?.items ?? [];
  const items: PublicDrug[] = Array.isArray(rawItems) ? rawItems : [rawItems];
  return { items, totalCount: parseInt(body?.totalCount ?? "0") };
}

async function fetchPageWithRetry(pageNo: number, retries = 3): Promise<{ items: PublicDrug[]; totalCount: number }> {
  let lastError: unknown = null;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchPage(pageNo);
    } catch (e) {
      lastError = e;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i)));
      }
    }
  }
  throw new Error(`페이지 ${pageNo} 실패 (${retries}회 재시도): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function mapDrug(item: PublicDrug) {
  const ediRaw = (item.EDI_CODE ?? "").trim();
  const ediCodes = ediRaw ? ediRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const insuranceCode = ediCodes[0] || null;

  return {
    categoryA: (item.PRODUCT_TYPE ?? "").trim() || null,
    ingredientName: (item.ITEM_INGR_NAME ?? item.ITEM_NAME ?? "").trim(),
    categoryB: null as string | null,
    companyName: (item.ENTP_NAME ?? "미상").trim(),
    productName: (item.ITEM_NAME ?? "").trim(),
    price: null as number | null,
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

async function processPage(pageItems: PublicDrug[]): Promise<number> {
  const drugs = pageItems
    .map(mapDrug)
    .filter((d) => d.productName && d.ingredientName);
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
          categoryA: drug.categoryA,
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

  // 순차 업데이트 (pool 고갈 방지)
  for (const { id, data } of toUpdate) {
    await withDbRetry(() => prisma.medication.update({ where: { id }, data }));
  }

  return drugs.length;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const testMode = body?.mode === "test";
  const startPage = Math.max(1, parseInt(body?.startPage) || 1);
  const rawBatch = parseInt(body?.batchSize);
  const batchSize = testMode ? 1 : Math.max(1, Math.min(30, Number.isFinite(rawBatch) ? rawBatch : 10));

  const pageErrors: { page: number; error: string }[] = [];
  let synced = 0;
  let totalPages = 0;
  let totalCount = 0;
  let endPage = startPage;

  try {
    // 첫 페이지로 totalCount 파악
    const first = await fetchPageWithRetry(startPage);
    totalCount = first.totalCount;
    if (totalCount === 0) {
      return NextResponse.json({
        error: "공공 API에서 데이터를 가져오지 못했어요. API 키를 확인해주세요.",
      }, { status: 502 });
    }
    totalPages = Math.ceil(totalCount / 100);
    endPage = Math.min(startPage + batchSize - 1, totalPages);

    // 첫 페이지 처리
    try {
      synced += await processPage(first.items);
    } catch (e) {
      pageErrors.push({ page: startPage, error: e instanceof Error ? e.message : String(e) });
    }

    // 나머지 페이지: 완전 순차 처리 (pool 고갈 방지)
    for (let p = startPage + 1; p <= endPage; p++) {
      try {
        const { items } = await fetchPageWithRetry(p);
        synced += await processPage(items);
      } catch (e) {
        pageErrors.push({ page: p, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const done = endPage >= totalPages;

    // 완료 시에만 lastMfdsSync 갱신
    if (done) {
      const now = new Date().toISOString();
      await prisma.$executeRaw`
        INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
        VALUES ('lastMfdsSync', ${now}, NOW())
        ON CONFLICT ("key") DO UPDATE SET "value" = ${now}, "updatedAt" = NOW()
      `.catch(() => null);
    }

    const [publicCount, excelCount] = await Promise.all([
      prisma.medication.count({ where: { source: "PUBLIC_API" } }),
      prisma.medication.count({ where: { source: "EXCEL" } }),
    ]);

    return NextResponse.json({
      success: true,
      synced,
      startPage,
      endPage,
      nextPage: done ? null : endPage + 1,
      totalPages,
      totalCount,
      totalPublic: totalCount,
      done,
      publicCount,
      excelCount,
      pageErrors: pageErrors.length > 0 ? pageErrors : undefined,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      startPage,
      endPage,
      synced,
      pageErrors: pageErrors.length > 0 ? pageErrors : undefined,
    }, { status: 500 });
  }
}

export async function GET() {
  const [publicCount, excelCount, lastSyncRows] = await Promise.all([
    prisma.medication.count({ where: { source: "PUBLIC_API" } }),
    prisma.medication.count({ where: { source: "EXCEL" } }),
    prisma.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "SystemSetting" WHERE "key" = 'lastMfdsSync'
    `.catch(() => [] as { value: string }[]),
  ]);
  const lastSync = lastSyncRows[0]?.value ?? null;
  return NextResponse.json({ publicCount, excelCount, total: publicCount + excelCount, lastSync });
}
