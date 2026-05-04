import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAdminOrService, isNextResponse } from "@/lib/auth-guard";
import { normalizeCompanyKey, normalizeProductKey } from "@/lib/utils";

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
  // 여러 EDI 코드를 모두 저장 (엑셀 업로드 시 어떤 코드로든 매칭되도록)
  const insuranceCode = ediCodes.length > 0 ? ediCodes.join(",") : null;

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

  // 1차 매칭: insuranceCode 기준 (기존 동작)
  const codes = drugs.map((d) => d.insuranceCode).filter(Boolean) as string[];
  const existingByCode = codes.length > 0
    ? await withDbRetry(() => prisma.medication.findMany({
        where: { insuranceCode: { in: codes } },
        select: { id: true, insuranceCode: true },
      }))
    : [];
  const codeMap = new Map<string, string>();
  for (const e of existingByCode) {
    if (e.insuranceCode) codeMap.set(e.insuranceCode, e.id);
  }

  // 2차 매칭: 1차에서 못 잡은 약품(특히 비급여라 EDI_CODE 비어 있는 케이스) 을
  // (productName + companyName) 정규화 키로 기존 레코드와 머지 — 중복 레코드 양산 방지.
  // productName 인덱스 활용: 정확 일치만 후보로 끌어오고 in-memory 에서 정규화 비교.
  const orphanProductNames = Array.from(new Set(
    drugs
      .filter((d) => !d.insuranceCode || !codeMap.has(d.insuranceCode))
      .map((d) => d.productName)
      .filter(Boolean)
  ));
  const productCandidates = orphanProductNames.length > 0
    ? await withDbRetry(() => prisma.medication.findMany({
        where: { productName: { in: orphanProductNames } },
        select: { id: true, productName: true, companyName: true, insuranceCode: true },
      }))
    : [];
  const nameKeyMap = new Map<string, { id: string; insuranceCode: string | null }>();
  for (const c of productCandidates) {
    const key = `${normalizeProductKey(c.productName)}|${normalizeCompanyKey(c.companyName)}`;
    if (key === "|") continue;
    if (!nameKeyMap.has(key)) nameKeyMap.set(key, { id: c.id, insuranceCode: c.insuranceCode });
  }

  const toCreate: typeof drugs = [];
  const toUpdate: {
    id: string;
    productName: string;
    ingredientName: string;
    companyName: string;
    categoryA: string | null;
    newInsuranceCode: string | null; // 기존이 NULL 일 때만 채울 후보
  }[] = [];

  for (const drug of drugs) {
    let foundId: string | null = null;
    let needsBackfillCode = false;
    if (drug.insuranceCode && codeMap.has(drug.insuranceCode)) {
      foundId = codeMap.get(drug.insuranceCode)!;
    } else {
      const compositeKey = `${normalizeProductKey(drug.productName)}|${normalizeCompanyKey(drug.companyName)}`;
      const candidate = compositeKey === "|" ? undefined : nameKeyMap.get(compositeKey);
      if (candidate) {
        foundId = candidate.id;
        // 기존 레코드 insuranceCode 가 NULL 이고 이번 드러그에 코드가 있으면 backfill
        if (!candidate.insuranceCode && drug.insuranceCode) needsBackfillCode = true;
      }
    }

    if (foundId) {
      toUpdate.push({
        id: foundId,
        productName: drug.productName,
        ingredientName: drug.ingredientName,
        companyName: drug.companyName,
        categoryA: drug.categoryA,
        newInsuranceCode: needsBackfillCode ? drug.insuranceCode : null,
      });
    } else {
      toCreate.push(drug);
    }
  }

  if (toCreate.length > 0) {
    await withDbRetry(() => prisma.medication.createMany({ data: toCreate, skipDuplicates: true }));
  }

  // Bulk UPDATE: insuranceCode 는 COALESCE 로 NULL 인 경우에만 채움 (덮어쓰지 않음)
  if (toUpdate.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < toUpdate.length; i += CHUNK) {
      const slice = toUpdate.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: (string | null)[] = [];
      let p = 1;
      for (const u of slice) {
        tuples.push(`($${p++}::text, $${p++}::text, $${p++}::text, $${p++}::text, $${p++}, $${p++}::text)`);
        params.push(u.id, u.productName, u.ingredientName, u.companyName, u.categoryA, u.newInsuranceCode);
      }
      const sql = `
        UPDATE "Medication" AS m
        SET "productName"    = v.pn,
            "ingredientName" = v.ing,
            "companyName"    = v.cn,
            "categoryA"      = v.ca,
            "insuranceCode"  = COALESCE(m."insuranceCode", v.ic),
            "updatedAt"      = NOW()
        FROM (VALUES ${tuples.join(", ")}) AS v(id, pn, ing, cn, ca, ic)
        WHERE m.id = v.id
      `;
      await withDbRetry(() => prisma.$executeRawUnsafe(sql, ...params));
    }
  }

  return drugs.length;
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrService(req);
  if (isNextResponse(guard)) return guard;
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

    const done = !testMode && endPage >= totalPages;
    const now = new Date().toISOString();

    // 테스트 모드: lastMfdsTestSync만 갱신
    if (testMode) {
      await prisma.$executeRaw`
        INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
        VALUES ('lastMfdsTestSync', ${now}, NOW())
        ON CONFLICT ("key") DO UPDATE SET "value" = ${now}, "updatedAt" = NOW()
      `.catch(() => null);
    }

    // 전체 동기화 완료: lastMfdsSync 갱신
    if (done) {
      await prisma.$executeRaw`
        INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
        VALUES ('lastMfdsSync', ${now}, NOW())
        ON CONFLICT ("key") DO UPDATE SET "value" = ${now}, "updatedAt" = NOW()
      `.catch(() => null);
    }

    const [publicCount, excelCount, syncRows] = await Promise.all([
      prisma.medication.count({ where: { source: "PUBLIC_API" } }),
      prisma.medication.count({ where: { source: "EXCEL" } }),
      prisma.$queryRaw<{ key: string; value: string }[]>`
        SELECT "key", "value" FROM "SystemSetting" WHERE "key" IN ('lastMfdsSync', 'lastMfdsTestSync')
      `.catch(() => [] as { key: string; value: string }[]),
    ]);
    const syncMap = Object.fromEntries(syncRows.map((r) => [r.key, r.value]));

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
      lastSync: syncMap.lastMfdsSync ?? null,
      lastTestSync: syncMap.lastMfdsTestSync ?? null,
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
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const [publicCount, excelCount, syncRows] = await Promise.all([
    prisma.medication.count({ where: { source: "PUBLIC_API" } }),
    prisma.medication.count({ where: { source: "EXCEL" } }),
    prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT "key", "value" FROM "SystemSetting" WHERE "key" IN ('lastMfdsSync', 'lastMfdsTestSync')
    `.catch(() => [] as { key: string; value: string }[]),
  ]);
  const syncMap = Object.fromEntries(syncRows.map((r) => [r.key, r.value]));
  return NextResponse.json({
    publicCount,
    excelCount,
    total: publicCount + excelCount,
    lastSync: syncMap.lastMfdsSync ?? null,
    lastTestSync: syncMap.lastMfdsTestSync ?? null,
  });
}
