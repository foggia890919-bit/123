// 의약품 마스터 주간 동기화 — 공공데이터 직통 (로컬 PC 실행 전용)
//
// 1) 식약처 의약품 허가정보 (DrugPrdtPrmsnInfoService07) → Medication upsert
//    - src/app/api/medications/sync/route.ts 의 로직을 워커용 pg 버전으로 포팅.
//      Vercel 크론은 하루 10페이지(1000건)만 돌고 이어가기가 없어 전체(4.3만건)를
//      영원히 못 돌던 문제 → 로컬에선 한 번에 전체 순회.
// 2) 심평원 약제급여목록 (dgamtCrtrInfoService1.2) → 약가/급여구분 채움
//    - 기존엔 한국 IP 가 필요해 AWS Lambda(hira-price-proxy) 경유였지만
//      이 워커는 한국 PC 에서 돌므로 직통 호출.
//
// 스케줄: 일요일 02:00 KST (SCHEDULE_MASTER_CRON 로 변경 가능)
// 수동 트리거: POST /sync-master (?mode=mfds|prices|full, ?maxPages=N)

import fs from "node:fs";
import { Pool } from "pg";
import { createId } from "@paralleldrive/cuid2";
import { normalizeProductKey, normalizeCompanyKey } from "./normalize.ts";

// ---------- 공통 ----------

let _pool: Pool | undefined;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
    });
  }
  return _pool;
}

// 공공데이터포털 서비스키 — env 우선, 없으면 로컬 처방통계 도구의 config.json 재사용
function getServiceKey(): string {
  const envKey = process.env.PUBLIC_DATA_API_KEY;
  if (envKey) return envKey;
  const fallbackPath =
    process.env.RX_TOOL_CONFIG ??
    "C:/Users/foggi/OneDrive/바탕 화면/클로드코드_스마트스토어/의약품처방통계조회/config.json";
  try {
    const cfg = JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
    if (cfg.serviceKey) return cfg.serviceKey as string;
  } catch {
    // fall through
  }
  throw new Error(
    "공공데이터 서비스키 없음 — .env 에 PUBLIC_DATA_API_KEY 를 넣거나 처방통계 도구 config.json 경로(RX_TOOL_CONFIG)를 지정하세요"
  );
}

// normalizeProductKey / normalizeCompanyKey 는 ./normalize.ts 로 분리 (export-ykorder 와 공용).

async function upsertSystemSetting(key: string, value: string) {
  await getPool().query(
    `INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT ("key") DO UPDATE SET "value" = $2, "updatedAt" = NOW()`,
    [key, value]
  );
}

// ---------- 1) 식약처 허가정보 전체 동기화 ----------

const MFDS_URL =
  "https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07";

interface PublicDrug { [key: string]: string | undefined }

async function fetchMfdsPage(pageNo: number): Promise<{ items: PublicDrug[]; totalCount: number }> {
  const url = new URL(MFDS_URL);
  url.searchParams.set("serviceKey", getServiceKey());
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("type", "json");
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`MFDS API ${res.status}`);
  const json = await res.json() as { body?: { items?: PublicDrug[] | PublicDrug; totalCount?: string } };
  const body = json?.body;
  const rawItems = body?.items ?? [];
  const items: PublicDrug[] = Array.isArray(rawItems) ? rawItems : [rawItems];
  return { items, totalCount: parseInt(String(body?.totalCount ?? "0")) };
}

async function fetchMfdsPageRetry(pageNo: number, retries = 3) {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchMfdsPage(pageNo);
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) await new Promise(r => setTimeout(r, 800 * Math.pow(2, i)));
    }
  }
  throw new Error(`페이지 ${pageNo} 실패: ${(lastErr as Error)?.message ?? lastErr}`);
}

interface MappedDrug {
  categoryA: string | null;
  ingredientName: string;
  companyName: string;
  productName: string;
  insuranceCode: string | null;
}

function mapDrug(item: PublicDrug): MappedDrug {
  const ediRaw = (item.EDI_CODE ?? "").trim();
  const ediCodes = ediRaw ? ediRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
  return {
    categoryA: (item.PRODUCT_TYPE ?? "").trim() || null,
    ingredientName: (item.ITEM_INGR_NAME ?? item.ITEM_NAME ?? "").trim(),
    companyName: (item.ENTP_NAME ?? "미상").trim(),
    productName: (item.ITEM_NAME ?? "").trim(),
    insuranceCode: ediCodes.length > 0 ? ediCodes.join(",") : null,
  };
}

async function processMfdsPage(pageItems: PublicDrug[]): Promise<{ created: number; updated: number }> {
  const pool = getPool();
  const drugs = pageItems.map(mapDrug).filter(d => d.productName && d.ingredientName);
  if (drugs.length === 0) return { created: 0, updated: 0 };

  // 1차: insuranceCode 매칭
  const codes = drugs.map(d => d.insuranceCode).filter(Boolean) as string[];
  const codeMap = new Map<string, string>();
  if (codes.length > 0) {
    const { rows } = await pool.query<{ id: string; insuranceCode: string }>(
      `SELECT id, "insuranceCode" FROM "Medication" WHERE "insuranceCode" = ANY($1::text[])`,
      [codes]
    );
    for (const r of rows) codeMap.set(r.insuranceCode, r.id);
  }

  // 2차: (제품명+제약사) 정규화 키 매칭 — 비급여 등 EDI 코드 없는 약 중복 방지
  const orphanNames = Array.from(new Set(
    drugs.filter(d => !d.insuranceCode || !codeMap.has(d.insuranceCode)).map(d => d.productName)
  ));
  const nameKeyMap = new Map<string, { id: string; insuranceCode: string | null }>();
  if (orphanNames.length > 0) {
    const { rows } = await pool.query<{ id: string; productName: string; companyName: string; insuranceCode: string | null }>(
      `SELECT id, "productName", "companyName", "insuranceCode" FROM "Medication" WHERE "productName" = ANY($1::text[])`,
      [orphanNames]
    );
    for (const c of rows) {
      const key = `${normalizeProductKey(c.productName)}|${normalizeCompanyKey(c.companyName)}`;
      if (key === "|") continue;
      if (!nameKeyMap.has(key)) nameKeyMap.set(key, { id: c.id, insuranceCode: c.insuranceCode });
    }
  }

  const toCreate: MappedDrug[] = [];
  const toUpdate: { id: string; d: MappedDrug; backfillCode: string | null }[] = [];
  for (const d of drugs) {
    let foundId: string | null = null;
    let backfillCode: string | null = null;
    if (d.insuranceCode && codeMap.has(d.insuranceCode)) {
      foundId = codeMap.get(d.insuranceCode)!;
    } else {
      const key = `${normalizeProductKey(d.productName)}|${normalizeCompanyKey(d.companyName)}`;
      const cand = key === "|" ? undefined : nameKeyMap.get(key);
      if (cand) {
        foundId = cand.id;
        if (!cand.insuranceCode && d.insuranceCode) backfillCode = d.insuranceCode;
      }
    }
    if (foundId) toUpdate.push({ id: foundId, d, backfillCode });
    else toCreate.push(d);
  }

  if (toCreate.length > 0) {
    const cols: string[] = [];
    const params: (string | null | boolean)[] = [];
    let p = 1;
    for (const d of toCreate) {
      cols.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, false, 'PUBLIC_API', NOW(), NOW())`);
      params.push(createId(), d.categoryA, d.ingredientName, d.companyName, d.productName, d.insuranceCode);
    }
    await pool.query(
      `INSERT INTO "Medication"
         (id, "categoryA", "ingredientName", "companyName", "productName", "insuranceCode",
          "isSettlement", "source", "createdAt", "updatedAt")
       VALUES ${cols.join(", ")}`,
      params
    );
  }

  if (toUpdate.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < toUpdate.length; i += CHUNK) {
      const slice = toUpdate.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: (string | null)[] = [];
      let p = 1;
      for (const u of slice) {
        tuples.push(`($${p++}::text, $${p++}::text, $${p++}::text, $${p++}::text, $${p++}, $${p++}::text)`);
        params.push(u.id, u.d.productName, u.d.ingredientName, u.d.companyName, u.d.categoryA, u.backfillCode);
      }
      await pool.query(
        `UPDATE "Medication" AS m
         SET "productName"    = v.pn,
             "ingredientName" = v.ing,
             "companyName"    = v.cn,
             "categoryA"      = v.ca,
             "insuranceCode"  = COALESCE(m."insuranceCode", v.ic),
             "updatedAt"      = NOW()
         FROM (VALUES ${tuples.join(", ")}) AS v(id, pn, ing, cn, ca, ic)
         WHERE m.id = v.id`,
        params
      );
    }
  }

  return { created: toCreate.length, updated: toUpdate.length };
}

export async function syncMfdsFull(opts: { maxPages?: number } = {}) {
  const first = await fetchMfdsPageRetry(1);
  const totalPages = Math.ceil(first.totalCount / 100);
  const endPage = opts.maxPages ? Math.min(opts.maxPages, totalPages) : totalPages;
  console.log(`[master-sync] 식약처 허가정보: ${first.totalCount}건 / ${totalPages}페이지 (이번 실행: ${endPage}페이지)`);

  let created = 0, updated = 0;
  const pageErrors: { page: number; error: string }[] = [];

  const r1 = await processMfdsPage(first.items).catch(e => { pageErrors.push({ page: 1, error: String(e) }); return null; });
  if (r1) { created += r1.created; updated += r1.updated; }

  for (let p = 2; p <= endPage; p++) {
    try {
      const { items } = await fetchMfdsPageRetry(p);
      const r = await processMfdsPage(items);
      created += r.created; updated += r.updated;
    } catch (e) {
      pageErrors.push({ page: p, error: (e as Error).message });
    }
    if (p % 50 === 0) console.log(`[master-sync] 식약처 ${p}/${endPage} 페이지 — 신규 ${created}, 갱신 ${updated}`);
    await new Promise(r => setTimeout(r, 150)); // 공공API 예의상 간격
  }

  if (!opts.maxPages) {
    await upsertSystemSetting("lastMfdsSync", new Date().toISOString()).catch(() => {});
  }
  console.log(`[master-sync] 식약처 완료 — 신규 ${created}, 갱신 ${updated}, 페이지오류 ${pageErrors.length}`);
  return { created, updated, totalPages, pageErrors };
}

// ---------- 2) 심평원 약가/급여구분 채움 (직통) ----------

const HIRA_URL = "https://apis.data.go.kr/B551182/dgamtCrtrInfoService1.2/getDgamtList";

interface HiraItem { mdsCd?: string; mxCprc?: string; payTpNm?: string }

async function fetchHiraByCompany(mnfEntpNm: string, pageNo: number, numOfRows = 1000):
  Promise<{ items: HiraItem[]; totalCount: number }> {
  const url = new URL(HIRA_URL);
  url.searchParams.set("serviceKey", getServiceKey());
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", String(numOfRows));
  url.searchParams.set("mnfEntpNm", mnfEntpNm);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HIRA API ${res.status}`);
  const xml = await res.text();
  const totalCount = parseInt(xml.match(/<totalCount>(\d+)<\/totalCount>/)?.[1] ?? "0");
  const items: HiraItem[] = (xml.match(/<item>([\s\S]*?)<\/item>/g) ?? []).map(block => {
    const get = (tag: string) => block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim();
    return { mdsCd: get("mdsCd"), mxCprc: get("mxCprc"), payTpNm: get("payTpNm") };
  });
  return { items, totalCount };
}

function normalizeCompanyForSearch(name: string): string {
  return name
    .replace(/주식회사\s*/g, "")
    .replace(/\s*\(주\)/g, "")
    .replace(/\s*㈜/g, "")
    .replace(/\s*\(유\)/g, "")
    .trim()
    .slice(0, 15);
}

export async function fillPricesFull(opts: { companyLimit?: number } = {}) {
  const pool = getPool();
  const { rows: companiesRaw } = await pool.query<{ companyName: string }>(
    `SELECT DISTINCT "companyName" FROM "Medication" WHERE "companyName" IS NOT NULL AND "companyName" <> ''`
  );
  let companies = companiesRaw.map(c => c.companyName);
  if (opts.companyLimit) companies = companies.slice(0, opts.companyLimit);
  console.log(`[master-sync] 심평원 약가: 제약사 ${companies.length}곳 조회 시작`);

  const hiraMap = new Map<string, { price: number | null; payTpNm: string | null }>();
  let scanned = 0, companyErrors = 0;

  async function processCompany(company: string) {
    const searchName = normalizeCompanyForSearch(company);
    if (!searchName) return;
    try {
      const first = await fetchHiraByCompany(searchName, 1);
      const pages = Math.ceil(first.totalCount / 1000);
      const allItems = [...first.items];
      for (let p = 2; p <= Math.min(pages, 5); p++) {
        const { items } = await fetchHiraByCompany(searchName, p);
        allItems.push(...items);
      }
      for (const item of allItems) {
        if (!item.mdsCd) continue;
        const normCode = item.mdsCd.replace(/^0+/, "");
        if (!normCode) continue;
        const priceNum = item.mxCprc ? parseInt(item.mxCprc.replace(/,/g, "")) : NaN;
        const price = !isNaN(priceNum) && priceNum > 0 ? priceNum : null;
        const payTpNm = item.payTpNm?.trim() || null;
        if (price === null && payTpNm === null) continue;
        hiraMap.set(normCode, { price, payTpNm });
      }
      scanned += allItems.length;
    } catch {
      companyErrors++;
    }
  }

  const CONCURRENCY = 3;
  for (let i = 0; i < companies.length; i += CONCURRENCY) {
    await Promise.allSettled(companies.slice(i, i + CONCURRENCY).map(processCompany));
    if ((i / CONCURRENCY) % 50 === 0 && i > 0) {
      console.log(`[master-sync] 심평원 ${i}/${companies.length} 제약사 — 수집 ${hiraMap.size}건`);
    }
    await new Promise(r => setTimeout(r, 120));
  }
  if (hiraMap.size === 0) throw new Error("심평원에서 약가 데이터를 못 가져옴");

  const codes = Array.from(hiraMap.keys());
  const { rows: targets } = await pool.query<{ id: string; matched: string; price: number | null; paymentType: string | null }>(
    `SELECT m.id, LTRIM(TRIM(code), '0') AS matched, m.price, m."paymentType"
     FROM "Medication" m, UNNEST(string_to_array(m."insuranceCode", ',')) AS code
     WHERE m."insuranceCode" IS NOT NULL AND LTRIM(TRIM(code), '0') = ANY($1::text[])`,
    [codes]
  );

  const updates = new Map<string, { price: number | null; payTpNm: string | null }>();
  for (const t of targets) {
    const entry = hiraMap.get(t.matched);
    if (!entry) continue;
    const priceChanged = entry.price !== null && t.price !== entry.price;
    const payChanged = entry.payTpNm !== null && t.paymentType !== entry.payTpNm;
    if (!priceChanged && !payChanged) continue;
    updates.set(t.id, { price: priceChanged ? entry.price : null, payTpNm: payChanged ? entry.payTpNm : null });
  }

  let filled = 0;
  const ids = Array.from(updates.keys());
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const tuples: string[] = [];
    const params: (string | number | null)[] = [];
    let p = 1;
    for (const id of slice) {
      const u = updates.get(id)!;
      tuples.push(`($${p++}::text, $${p++}::int, $${p++}::text)`);
      params.push(id, u.price, u.payTpNm);
    }
    await pool.query(
      `UPDATE "Medication" AS m
       SET "price"       = COALESCE(v.price, m."price"),
           "paymentType" = COALESCE(v.payment_type, m."paymentType"),
           "updatedAt"   = NOW()
       FROM (VALUES ${tuples.join(", ")}) AS v(id, price, payment_type)
       WHERE m.id = v.id`,
      params
    );
    filled += slice.length;
  }

  await upsertSystemSetting("lastPriceFill", new Date().toISOString()).catch(() => {});
  console.log(`[master-sync] 심평원 완료 — 변경 ${filled}건, 스캔 ${scanned}건, 제약사 오류 ${companyErrors}곳`);
  return { filled, scanned, companyErrors, hiraMapSize: hiraMap.size };
}

// ---------- 실행 관리 ----------

let running = false;
export function isMasterSyncRunning() { return running; }

export async function runMasterSync(mode: "full" | "mfds" | "prices" = "full", opts: { maxPages?: number; companyLimit?: number } = {}) {
  if (running) throw new Error("master sync already running");
  running = true;
  const startedAt = Date.now();
  try {
    const result: Record<string, unknown> = {};
    if (mode === "full" || mode === "mfds") result.mfds = await syncMfdsFull(opts);
    if (mode === "full" || mode === "prices") result.prices = await fillPricesFull(opts);
    const min = Math.round((Date.now() - startedAt) / 60_000);
    console.log(`[master-sync] 전체 완료 (${min}분)`);
    return result;
  } finally {
    running = false;
  }
}
