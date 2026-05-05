import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export const maxDuration = 300;

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;
// 두 UDDI 순서대로 시도 (1d0f74ec = 새버전, 6753c7f1 = 구버전 fallback)
const UDDI_CANDIDATES = [
  "6753c7f1-65ed-4bbe-9e98-cd6b7b156a92",
  "1d0f74ec-fc9e-4386-9f67-9b1295b4c149",
];
const BASE = "https://api.odcloud.kr/api/15118958/v1/uddi:";

interface AtcItem { [key: string]: string | number | undefined }

async function fetchPage(page: number, uddi: string): Promise<{ items: AtcItem[]; totalCount: number }> {
  const url = new URL(`${BASE}${uddi}`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", "1000");
  url.searchParams.set("serviceKey", API_KEY);

  const res = await fetch(url.toString(), { cache: "no-store" });
  const text = await res.text().catch(() => "");
  if (!res.ok || !text.trimStart().startsWith("{")) {
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }

  let json: Record<string, unknown>;
  try { json = JSON.parse(text); } catch {
    throw new Error(`JSON 파싱 실패: ${text.slice(0, 200)}`);
  }
  const items: AtcItem[] = Array.isArray(json?.data) ? (json.data as AtcItem[]) : [];
  const totalCount = parseInt(String(json?.totalCount ?? json?.matchCount ?? "0"));
  return { items, totalCount };
}

async function fetchPageWithRetry(page: number, uddi: string, retries = 3): Promise<{ items: AtcItem[]; totalCount: number }> {
  let lastError: unknown = null;
  for (let i = 0; i < retries; i++) {
    try { return await fetchPage(page, uddi); }
    catch (e) {
      lastError = e;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i)));
    }
  }
  throw new Error(`ATC 페이지 ${page} 실패: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

// 두 UDDI 중 첫 번째로 응답하는 것 선택
async function resolveUddi(): Promise<{ uddi: string; first: { items: AtcItem[]; totalCount: number } }> {
  for (const uddi of UDDI_CANDIDATES) {
    try {
      const first = await fetchPageWithRetry(1, uddi, 2);
      if (first.totalCount > 0) return { uddi, first };
    } catch { /* 다음 시도 */ }
  }
  throw new Error(`모든 UDDI 시도 실패: ${UDDI_CANDIDATES.join(", ")}`);
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
  apiProductName: string;
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
    /ATC코드.*명칭|ATC.*명칭/i,
  ]);
  // 규격 / 함량 / 용량 / strength / spec (단위 제외 — "정"·"캡슐" 같은 값은 부적합)
  const spec = findValue(item, [
    /^규격$/,
    /^함량$/,
    /^용량$/,
    /strength|dosage/i,
    /^spec$/i,
  ]);
  const apiProductName = findValue(item, [/^제품명$/]);
  return { ingredientCode, productCode, ingredientName, spec, apiProductName };
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

// 제품명에서 용량(숫자+단위) 추출 — productName 보완용
function extractDoseFromName(name: string): string | null {
  if (!name) return null;
  const UNIT = "(?:mg|mcg|μg|ug|g|ml|mL|IU|iu|%|mEq|밀리그[람램]|마이크로그[람램]|그[람램]|밀리리터|리터|유닛|단위)";
  const m = name.match(new RegExp(`(\\d[\\d.,/]*\\s*${UNIT})`, "i"));
  return m ? m[1].trim() : null;
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
    const { uddi, first: { items: firstItems, totalCount } } = await resolveUddi();

    if (totalCount === 0 || firstItems.length === 0) {
      return NextResponse.json({
        error: "ATC API에서 데이터를 가져오지 못했어요.",
        uddi,
        sampleKeys: Object.keys(firstItems[0] ?? {}),
        sampleItem: firstItems[0] ?? null,
        totalCount,
      }, { status: 502 });
    }

    const totalPages = Math.ceil(totalCount / 1000);
    const allItems: AtcItem[] = [...firstItems];
    if (totalPages > 1) {
      const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      const PAGE_CONCURRENCY = 5;
      for (let i = 0; i < remainingPages.length; i += PAGE_CONCURRENCY) {
        const chunk = remainingPages.slice(i, i + PAGE_CONCURRENCY);
        const results = await Promise.all(chunk.map((p) => fetchPageWithRetry(p, uddi)));
        for (const r of results) allItems.push(...r.items);
      }
    }

    const infoMap = new Map<string, { ingredientCode: string; apiName: string; apiSpec: string; apiDose: string | null }>();
    let withName = 0, withSpec = 0, withEither = 0;
    for (const item of allItems) {
      const codes = extractCodes(item);
      if (!codes) continue;
      const apiName = codes.ingredientName;
      const apiSpec = normalizeSpec(codes.spec);
      const apiDose = extractDoseFromName(codes.apiProductName) ?? extractDoseFromName(apiSpec) ?? null;
      if (apiName) withName++;
      if (apiSpec) withSpec++;
      if (apiName || apiSpec) withEither++;
      // 보험코드 정규화: HIRA는 8자리("53600230"), KMD는 9자리 0패딩("053600230")로
      // 저장된 경우가 있어 leading zero 제거 후 비교 (DB 매칭도 LTRIM 처리).
      const normProductCode = codes.productCode.replace(/^0+/, "");
      if (!normProductCode) continue;
      const prev = infoMap.get(normProductCode);
      const prevLen = prev ? prev.apiName.length + prev.apiSpec.length : -1;
      const curLen = apiName.length + apiSpec.length;
      if (curLen > prevLen) {
        infoMap.set(normProductCode, { ingredientCode: codes.ingredientCode, apiName, apiSpec, apiDose });
      }
    }

    if (infoMap.size === 0) {
      return NextResponse.json({
        error: "주성분코드/제품코드 필드를 찾지 못했어요.",
        sampleKeys: Object.keys(firstItems[0] ?? {}),
      }, { status: 400 });
    }

    // SELECT step: insuranceCode 가 콤마로 묶인 경우(CodeA,CodeB)도 UNNEST 로 매칭.
    // UPDATE step: 매칭된 medication 들을 UNNEST 한 번 호출로 bulk UPDATE — 직렬 N개 UPDATE 대신 한 번의 round-trip.
    const upd: { id: string; ingredientCode: string; ingredientName: string | null; productName: string | null }[] = [];
    let ingredientChanged = 0;
    let productNameUpdated = 0;
    const allProductCodes = Array.from(infoMap.keys());
    const BATCH = 500;

    for (let i = 0; i < allProductCodes.length; i += BATCH) {
      const batch = allProductCodes.slice(i, i + BATCH);

      // matched 도 LTRIM 한 값을 돌려줘야 위에서 만든 normProductCode 키로 infoMap.get 가능
      const matchRows = await withDbRetry(() => prisma.$queryRaw<{ id: string; productName: string; matched: string }[]>`
        SELECT m.id, m."productName", LTRIM(TRIM(code), '0') AS matched
        FROM "Medication" m,
             UNNEST(string_to_array(m."insuranceCode", ',')) AS code
        WHERE m."insuranceCode" IS NOT NULL
          AND LTRIM(TRIM(code), '0') = ANY(${batch})
      `);

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

        const currentDose = extractDoseFromName(row.productName);
        const newProductName = (!currentDose && info.apiDose)
          ? `${row.productName.trim()} ${info.apiDose}`
          : null;

        upd.push({
          id: row.id,
          ingredientCode: info.ingredientCode,
          ingredientName: newIngredientName,
          productName: newProductName,
        });
        if (newIngredientName) ingredientChanged++;
        if (newProductName) productNameUpdated++;
      }
    }

    // COALESCE: name/product 가 null 이면 기존 값 유지 (기존 ...(x ? {x} : {}) 와 동일 의미)
    const UPDATE_CHUNK = 1000;
    let updated = 0;
    for (let i = 0; i < upd.length; i += UPDATE_CHUNK) {
      const slice = upd.slice(i, i + UPDATE_CHUNK);
      const ids = slice.map((u) => u.id);
      const codes = slice.map((u) => u.ingredientCode);
      const names = slice.map((u) => u.ingredientName);
      const products = slice.map((u) => u.productName);

      const n = await withDbRetry(() => prisma.$executeRaw`
        UPDATE "Medication" m
        SET
          "ingredientCode" = v.ingredient_code,
          "ingredientName" = COALESCE(v.ingredient_name, m."ingredientName"),
          "productName"    = COALESCE(v.product_name,    m."productName"),
          "updatedAt"      = NOW()
        FROM UNNEST(
          ${ids}::text[],
          ${codes}::text[],
          ${names}::text[],
          ${products}::text[]
        ) AS v(id, ingredient_code, ingredient_name, product_name)
        WHERE m.id = v.id
      `);
      updated += Number(n);
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

    // "ATC코드 명칭" 실제 값 샘플 (비어있으면 추출 0건 원인)
    const atcNameSamples = firstItems.slice(0, 5).map((it) => {
      const key = Object.keys(it).find((k) => /ATC코드.*명칭|ATC.*명칭/i.test(k)) ?? "(없음)";
      return { key, value: it[key] ?? "" };
    });

    return NextResponse.json({
      success: true,
      uddi,
      total: totalCount,
      mapped: infoMap.size,
      updated,
      ingredientUpdated: ingredientChanged,
      productNameUpdated,
      filled,
      lastSync: now,
      totalInDb: total,
      diagnostics: {
        sampleKeys: Object.keys(firstItems[0] ?? {}),
        sampleItem: firstItems[0] ?? null,
        atcNameSamples,
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
