import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

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

// 필드명 패턴 매칭으로 extract (정확한 키명을 몰라도 "주성분"·"규격" 포함된 키 찾음)
function findValue(item: AtcItem, patterns: RegExp[]): string {
  for (const key of Object.keys(item)) {
    for (const pat of patterns) {
      if (pat.test(key)) {
        const val = item[key];
        if (val != null) {
          const s = String(val).trim();
          if (s) return s;
        }
      }
    }
  }
  return "";
}

function extractCodes(item: AtcItem): AtcExtract | null {
  const ingredientCode = findValue(item, [/주성분.*코드|^주성분_?코드$/i, /mainIngdtCode|ingdtCode/i]);
  const productCode = findValue(item, [/제품.*코드|^제품_?코드$/i, /itemCode|ediCode/i]);
  if (!ingredientCode || !productCode) return null;
  // 주성분명 / 주성분 / 성분명 / 성분 (코드 제외)
  const ingredientName = findValue(item, [
    /^주성분명?$/,
    /^성분명?$/,
    /ingdtName|ingredientName|mainIngdtName/i,
  ]);
  // 규격 / 함량 / 용량 / strength / spec (단위 제외 — "정"·"캡슐" 같은 값은 부적합)
  const spec = findValue(item, [
    /^규격$/,
    /^함량$/,
    /^용량$/,
    /strength|dosage/i,
    /^spec$/i,
  ]);
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
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
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

    const infoMap = new Map<string, { ingredientCode: string; apiName: string; apiSpec: string }>();
    let withName = 0, withSpec = 0, withEither = 0;
    for (const item of allItems) {
      const codes = extractCodes(item);
      if (!codes) continue;
      const apiName = codes.ingredientName;
      const apiSpec = normalizeSpec(codes.spec);
      if (apiName) withName++;
      if (apiSpec) withSpec++;
      if (apiName || apiSpec) withEither++;
      const prev = infoMap.get(codes.productCode);
      const prevLen = prev ? prev.apiName.length + prev.apiSpec.length : -1;
      const curLen = apiName.length + apiSpec.length;
      if (curLen > prevLen) {
        infoMap.set(codes.productCode, { ingredientCode: codes.ingredientCode, apiName, apiSpec });
      }
    }

    if (infoMap.size === 0) {
      return NextResponse.json({
        error: "주성분코드/제품코드 필드를 찾지 못했어요.",
        sampleKeys: Object.keys(firstItems[0] ?? {}),
      }, { status: 400 });
    }

    // bulk UPDATE using UNNEST to handle comma-separated insuranceCodes
    // (fixes: exact-match was missing meds where insuranceCode = "CodeA,CodeB")
    let updated = 0;
    let ingredientChanged = 0;
    const allProductCodes = Array.from(infoMap.keys());
    const BATCH = 500;

    for (let i = 0; i < allProductCodes.length; i += BATCH) {
      const batch = allProductCodes.slice(i, i + BATCH);

      // STEP 1: find medication IDs whose insuranceCode (possibly comma-separated) contains any code in this batch
      const matchRows = await withDbRetry(() => prisma.$queryRaw<{ id: string; matched: string }[]>`
        SELECT m.id, TRIM(code) AS matched
        FROM "Medication" m,
             UNNEST(string_to_array(m."insuranceCode", ',')) AS code
        WHERE m."insuranceCode" IS NOT NULL
          AND TRIM(code) = ANY(${batch})
      `);

      // STEP 2: update each matched med (deduplicated by id, first match wins)
      const seen = new Set<string>();
      for (const row of matchRows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const info = infoMap.get(row.matched);
        if (!info) continue;

        const newIngredientName =
          info.apiName && info.apiSpec ? `${info.apiName} ${info.apiSpec}`
          : info.apiName ? info.apiName
          : null;

        await withDbRetry(() => prisma.medication.update({
          where: { id: row.id },
          data: {
            ingredientCode: info.ingredientCode,
            ...(newIngredientName ? { ingredientName: newIngredientName } : {}),
            updatedAt: new Date(),
          },
        }));
        updated++;
        if (newIngredientName) ingredientChanged++;
      }
    }

    const now = new Date().toISOString();
    await withDbRetry(() => prisma.$executeRaw`
      INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
      VALUES ('lastAtcSync', ${now}, NOW())
      ON CONFLICT ("key") DO UPDATE SET "value" = ${now}, "updatedAt" = NOW()
    `).catch(() => null);

    // 최종 카운트 포함 응답 (프론트에서 바로 박스 갱신 가능하게)
    const [filled, total] = await Promise.all([
      withDbRetry(() => prisma.medication.count({ where: { ingredientCode: { not: null } } })),
      withDbRetry(() => prisma.medication.count()),
    ]);

    // 샘플 3개 (실제 DB 반영 확인용)
    const sampleRows = await withDbRetry(() => prisma.medication.findMany({
      where: { ingredientCode: { not: null }, insuranceCode: { not: null } },
      select: { productName: true, ingredientName: true, insuranceCode: true },
      take: 5,
      orderBy: { updatedAt: "desc" },
    })).catch(() => []);

    return NextResponse.json({
      success: true,
      total: totalCount,
      mapped: infoMap.size,
      updated,
      ingredientUpdated: ingredientChanged,
      filled,
      lastSync: now,
      totalInDb: total,
      diagnostics: {
        sampleKeys: Object.keys(firstItems[0] ?? {}),
        sampleItem: firstItems[0] ?? null,
        withName,
        withSpec,
        withEither,
        sampleRows,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const [filled, total, settingRows] = await Promise.all([
    prisma.medication.count({ where: { ingredientCode: { not: null } } }),
    prisma.medication.count(),
    prisma.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "SystemSetting" WHERE "key" = 'lastAtcSync'
    `.catch(() => [] as { value: string }[]),
  ]);
  return NextResponse.json({ filled, total, lastSync: settingRows[0]?.value ?? null });
}
