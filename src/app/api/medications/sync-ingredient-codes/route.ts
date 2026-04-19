import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;
const BASE_URL = "https://api.odcloud.kr/api/15118958/v1/uddi:6753c7f1-65ed-4bbe-9e98-cd6b7b156a92";

interface AtcItem { [key: string]: string | undefined }

async function fetchPage(page: number): Promise<{ items: AtcItem[]; totalCount: number }> {
  const url = new URL(BASE_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", "1000");
  url.searchParams.set("serviceKey", API_KEY);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const items: AtcItem[] = Array.isArray(json?.data) ? json.data : [];
  const totalCount = parseInt(json?.totalCount ?? json?.matchCount ?? "0");
  return { items, totalCount };
}

async function fetchPageWithRetry(page: number, retries = 3): Promise<{ items: AtcItem[]; totalCount: number }> {
  let lastError: unknown = null;
  for (let i = 0; i < retries; i++) {
    try { return await fetchPage(page); }
    catch (e) {
      lastError = e;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i)));
    }
  }
  throw new Error(`ATC 페이지 ${page} 실패: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function isTransientDbError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /max clients|EMAXCONN|connection|ECONNREFUSED|ETIMEDOUT|pool/i.test(msg);
}

async function withDbRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (!isTransientDbError(e) || i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 600 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

interface AtcExtract {
  ingredientCode: string;
  productCode: string;
  ingredientName: string;
  spec: string;
}

function extractCodes(item: AtcItem): AtcExtract | null {
  const ingredientCode = String(
    item["주성분코드"] ?? item["주성분_코드"] ?? item["ingdtCode"] ?? item["mainIngdtCode"] ?? ""
  ).trim();
  const productCode = String(
    item["제품코드"] ?? item["제품_코드"] ?? item["itemCode"] ?? item["ediCode"] ?? ""
  ).trim();
  if (!ingredientCode || !productCode) return null;
  // 약가마스터 필드 변형 다수 대응
  const ingredientName = String(
    item["주성분명"] ?? item["성분명"] ?? item["주성분"] ?? item["성분"] ??
    item["ingdtName"] ?? item["mainIngdtName"] ?? item["ingredientName"] ?? ""
  ).trim();
  const spec = String(
    item["규격"] ?? item["규격단위"] ?? item["함량"] ?? item["용량"] ??
    item["단위"] ?? item["spec"] ?? item["dosage"] ?? ""
  ).trim();
  return { ingredientCode, productCode, ingredientName, spec };
}

// "10MG" → "10mg", "10 mg" → "10mg", "5ML" → "5ml"
function normalizeSpec(spec: string): string {
  if (!spec) return "";
  return spec
    .replace(/\s+/g, "")
    .replace(/MG\b/gi, "mg")
    .replace(/ML\b/gi, "ml")
    .replace(/MCG\b/gi, "mcg")
    .replace(/IU\b/gi, "IU")
    .replace(/G\b/gi, "g")
    .trim();
}

// "아토르바스타틴" + "10mg" → "아토르바스타틴 10mg"
function combineIngredient(name: string, spec: string): string {
  const n = name.trim();
  const s = normalizeSpec(spec);
  if (n && s) return `${n} ${s}`;
  return n || s;
}

export async function POST() {
  try {
    const { items: firstItems, totalCount } = await fetchPageWithRetry(1);

    if (totalCount === 0 || firstItems.length === 0) {
      return NextResponse.json({
        error: "ATC API에서 데이터를 가져오지 못했어요.",
        sampleKeys: Object.keys(firstItems[0] ?? {}),
        sampleItem: firstItems[0] ?? null,
        totalCount,
      }, { status: 502 });
    }

    const totalPages = Math.ceil(totalCount / 1000);
    const allItems: AtcItem[] = [...firstItems];
    for (let page = 2; page <= totalPages; page++) {
      const { items } = await fetchPageWithRetry(page);
      allItems.push(...items);
    }

    const infoMap = new Map<string, { ingredientCode: string; ingredientDisplay: string }>();
    let withName = 0, withSpec = 0, withEither = 0;
    for (const item of allItems) {
      const codes = extractCodes(item);
      if (!codes) continue;
      if (codes.ingredientName) withName++;
      if (codes.spec) withSpec++;
      if (codes.ingredientName || codes.spec) withEither++;
      const ingredientDisplay = combineIngredient(codes.ingredientName, codes.spec);
      const prev = infoMap.get(codes.productCode);
      if (!prev || (ingredientDisplay.length > prev.ingredientDisplay.length)) {
        infoMap.set(codes.productCode, { ingredientCode: codes.ingredientCode, ingredientDisplay });
      }
    }

    if (infoMap.size === 0) {
      return NextResponse.json({
        error: "주성분코드/제품코드 필드를 찾지 못했어요.",
        sampleKeys: Object.keys(firstItems[0] ?? {}),
      }, { status: 400 });
    }

    // raw SQL bulk UPDATE: categoryB + ingredientName(주성분명+규격) 동시 갱신
    // ingredientName은 v.ingNew가 비어있지 않을 때만 덮어씀 (OTC 등 누락 품목 보호)
    let updated = 0;
    let ingredientUpdated = 0;
    const entries = Array.from(infoMap.entries());
    const BATCH = 500;

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const values = batch.map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3})`).join(", ");
      const params: string[] = [];
      for (const [productCode, info] of batch) {
        params.push(productCode, info.ingredientCode, info.ingredientDisplay);
      }

      const result = await withDbRetry(() => prisma.$queryRawUnsafe<{ id: string; ingNew: string }[]>(
        `UPDATE "Medication" AS m
         SET "categoryB" = v."categoryB",
             "ingredientName" = CASE WHEN v."ingNew" <> '' THEN v."ingNew" ELSE m."ingredientName" END,
             "updatedAt" = NOW()
         FROM (VALUES ${values}) AS v("insuranceCode", "categoryB", "ingNew")
         WHERE m."insuranceCode" = v."insuranceCode"
         RETURNING m.id, v."ingNew" AS "ingNew"`,
        ...params
      ));
      updated += result.length;
      ingredientUpdated += result.filter((r) => r.ingNew && r.ingNew.length > 0).length;
    }

    const now = new Date().toISOString();
    await withDbRetry(() => prisma.$executeRaw`
      INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
      VALUES ('lastAtcSync', ${now}, NOW())
      ON CONFLICT ("key") DO UPDATE SET "value" = ${now}, "updatedAt" = NOW()
    `).catch(() => null);

    // 최종 카운트 포함 응답 (프론트에서 바로 박스 갱신 가능하게)
    const [filled, total] = await Promise.all([
      withDbRetry(() => prisma.medication.count({ where: { categoryB: { not: null } } })),
      withDbRetry(() => prisma.medication.count()),
    ]);

    return NextResponse.json({
      success: true,
      total: totalCount,
      mapped: infoMap.size,
      updated,
      ingredientUpdated,
      filled,
      lastSync: now,
      totalInDb: total,
      diagnostics: {
        sampleKeys: Object.keys(firstItems[0] ?? {}),
        sampleItem: firstItems[0] ?? null,
        withName,
        withSpec,
        withEither,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  const [filled, total, settingRows] = await Promise.all([
    prisma.medication.count({ where: { categoryB: { not: null } } }),
    prisma.medication.count(),
    prisma.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "SystemSetting" WHERE "key" = 'lastAtcSync'
    `.catch(() => [] as { value: string }[]),
  ]);
  return NextResponse.json({ filled, total, lastSync: settingRows[0]?.value ?? null });
}
