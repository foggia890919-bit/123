import { Pool } from "pg";
import { createId } from "@paralleldrive/cuid2";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { InventoryItem, WholesaleAdapter } from "../../src/scrapers/core/types.ts";

// Worker uses pg directly (no Prisma). All schemas mirror prisma/schema.prisma.
// IDs are generated client-side as cuid2 to match Prisma's @default(cuid()) behavior
// (cuid2 is the modern replacement; same alphabet rules).

const url = process.env.DATABASE_URL;

let pool: Pool | undefined;

export function hasDb(): boolean {
  return !!url;
}

export function getPool(): Pool {
  if (!url) throw new Error("DATABASE_URL not set");
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

// Ensure the WholesaleSite row exists before any job or snapshot is written.
// Without this, the FK constraint on InventorySnapshot.siteKey → WholesaleSite.key
// causes every INSERT to fail when the DB has just been provisioned.
export async function ensureSite(adapter: WholesaleAdapter): Promise<void> {
  await getPool().query(
    `INSERT INTO "WholesaleSite" ("key","name","baseUrl","loginUrl","active","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,true,NOW(),NOW())
     ON CONFLICT ("key") DO UPDATE
       SET "name"=$2, "baseUrl"=$3, "loginUrl"=$4, "updatedAt"=NOW()`,
    [adapter.key, adapter.name, adapter.baseUrl, adapter.loginUrl]
  );
}

export interface ExcelMedRow {
  insuranceCode: string;
  productName: string;
}

// Returns deduped list of insurance codes for ALL medications (HIRA 공공데이터 포함).
// 이전엔 source='EXCEL' (요율표 업로드) 만 가져왔지만, 사용자 의도는 전체 의약품.
// 함수명은 기존 호출처 호환을 위해 유지하되 의미는 "모든 의약품 보험코드" 로 확장.
export async function loadExcelMedicationCodes(): Promise<ExcelMedRow[]> {
  const { rows } = await getPool().query<{ insuranceCode: string; productName: string }>(
    `SELECT DISTINCT ON ("insuranceCode") "insuranceCode", "productName"
     FROM "Medication"
     WHERE "insuranceCode" IS NOT NULL
       AND "insuranceCode" <> ''
     ORDER BY "insuranceCode", "createdAt" DESC`
  );
  return rows;
}

// 비급여(보험코드 없음) 대상 — 제품명으로 검색해야 하는 약들.
export interface NonInsuredTarget {
  medicationId: string;
  productName: string;
}

export async function loadNonInsuredTargets(): Promise<NonInsuredTarget[]> {
  const limit = Math.max(1, Number(process.env.NONINSURED_LIMIT ?? 2000));
  const pool = getPool();

  const { rows } = await pool.query<NonInsuredTarget>(
    `SELECT id AS "medicationId", "productName"
     FROM "Medication"
     WHERE ("insuranceCode" IS NULL OR "insuranceCode" = '')
       AND ("isSettlement" = true OR source = 'EXCEL' OR "paymentType" = '비급여')
     ORDER BY "createdAt" DESC
     LIMIT ${limit}`
  );

  const byId = new Map<string, NonInsuredTarget>();
  for (const r of rows) byId.set(r.medicationId, r);

  // 선택: noninsured-extra.txt 에 적힌 제품명을 추가 대상으로 편입.
  // 한 줄에 하나, 빈 줄/# 주석 무시. DB에서 이름으로 찾아 medicationId 확보.
  try {
    const extraPath = resolve(process.cwd(), "noninsured-extra.txt");
    if (existsSync(extraPath)) {
      const content = readFileSync(extraPath, "utf-8");
      const names = content
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith("#"));
      for (const name of names) {
        const { rows: matched } = await pool.query<NonInsuredTarget>(
          `SELECT id AS "medicationId", "productName"
           FROM "Medication"
           WHERE "productName" ILIKE '%' || $1 || '%'
           LIMIT 5`,
          [name]
        );
        if (matched.length === 0) {
          console.warn(`[noninsured] "${name}" DB 미매칭 — 건너뜀`);
          continue;
        }
        for (const m of matched) {
          if (!byId.has(m.medicationId)) byId.set(m.medicationId, m);
        }
      }
    }
  } catch (err) {
    console.warn(`[noninsured] extra 파일 처리 실패: ${(err as Error).message}`);
  }

  return Array.from(byId.values());
}

export interface SnapshotInsert {
  siteKey: string;
  insuranceCode: string;
  item: InventoryItem;
  // 스냅샷 저장에 쓸 키를 명시적으로 지정 (비급여 이름배치의 의사 키 `NC:{medicationId}` 등).
  // 지정되면 item.insuranceCode / insuranceCode 대신 이 값을 그대로 사용한다.
  snapshotKey?: string;
}

export async function saveSnapshots(rows: SnapshotInsert[]): Promise<number> {
  if (rows.length === 0) return 0;

  // 같은 (siteKey, 스냅샷 키)가 한 INSERT 문 안에 두 번 들어가면 ON CONFLICT 가
  // "cannot affect row a second time" 로 실패한다 — 한 코드에 규격이 2개 이상(items 2+)이면
  // 항상 발생해 그 코드의 데이터가 전부 유실됐다. INSERT 전에 키 단위로 병합:
  //   stock = null-safe 합산 (모두 null 이면 null, 하나라도 숫자면 숫자 합)
  //   productName/spec/manufacturer/raw = 첫 항목 값
  //   unitPrice = 첫 non-null 값
  // (src/app/api/inventory/check/route.ts 라이브 경로의 aggMap 과 동일한 규칙.)
  // 청크 간 중복도 문제없도록 병합은 전체 rows 에 대해 먼저 수행한다.
  interface MergedSnapshot {
    siteKey: string;
    key: string;                     // InventorySnapshot.insuranceCode 에 들어갈 값
    productName: string;
    spec: string | null;
    manufacturer: string | null;
    unitPrice: number | null;
    stock: number | null;
    raw: Record<string, unknown> | undefined;
  }
  const aggMap = new Map<string, MergedSnapshot>();
  for (const r of rows) {
    const key = r.snapshotKey ?? (r.item.insuranceCode || r.insuranceCode);
    const mapKey = `${r.siteKey}|${key}`;
    const cur = aggMap.get(mapKey);
    if (!cur) {
      aggMap.set(mapKey, {
        siteKey: r.siteKey,
        key,
        productName: r.item.productName,
        spec: r.item.spec ?? null,
        manufacturer: r.item.manufacturer ?? null,
        unitPrice: r.item.unitPrice ?? null,
        stock: r.item.stock ?? null,
        raw: r.item.raw,
      });
    } else {
      cur.stock = cur.stock != null && r.item.stock != null
        ? cur.stock + r.item.stock
        : cur.stock ?? r.item.stock ?? null;
      if (cur.unitPrice == null && r.item.unitPrice != null) cur.unitPrice = r.item.unitPrice;
    }
  }
  const merged = Array.from(aggMap.values());

  const client = await getPool().connect();
  try {
    // Batch insert in chunks of 500 to keep parameter count under postgres limit (65k)
    const CHUNK = 500;
    let written = 0;
    for (let i = 0; i < merged.length; i += CHUNK) {
      const slice = merged.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let p = 1;
      for (const m of slice) {
        const id = createId();
        values.push(
          id,
          m.siteKey,
          m.key,
          m.productName,
          m.spec,
          m.manufacturer,
          m.unitPrice,
          m.stock,
          m.raw ? JSON.stringify(m.raw) : null,
        );
        placeholders.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, NOW())`
        );
      }
      // 같은 (사이트, 보험코드)는 한 줄만 유지 — 새 재고가 들어오면 이전 줄을 덮어쓴다.
      const sql = `INSERT INTO "InventorySnapshot"
        ("id","siteKey","insuranceCode","productName","spec","manufacturer","unitPrice","stock","raw","scrapedAt")
        VALUES ${placeholders.join(",")}
        ON CONFLICT ("siteKey","insuranceCode") DO UPDATE SET
          "productName" = EXCLUDED."productName",
          "spec" = EXCLUDED."spec",
          "manufacturer" = EXCLUDED."manufacturer",
          "unitPrice" = EXCLUDED."unitPrice",
          "stock" = EXCLUDED."stock",
          "raw" = EXCLUDED."raw",
          "scrapedAt" = EXCLUDED."scrapedAt"`;
      const res = await client.query(sql, values);
      written += res.rowCount ?? slice.length;
    }
    return written;
  } finally {
    client.release();
  }
}

export interface JobStart {
  siteKey: string;
  mode: string;
  totalCodes: number;
}

export async function startJob({ siteKey, mode, totalCodes }: JobStart): Promise<string> {
  // Ensure WholesaleSite row exists so ScrapeJob.siteKey never violates the FK.
  // We look up adapter metadata from the ALL_ADAPTERS registry.
  // (Inline import to avoid circular deps — db.ts has no adapter dependency otherwise.)
  try {
    const { ALL_ADAPTERS } = await import("../../src/scrapers/adapters/index.ts");
    const adapter = ALL_ADAPTERS[siteKey];
    if (adapter) await ensureSite(adapter);
  } catch (err) {
    console.error(`[db] ensureSite failed for ${siteKey}:`, (err as Error).message);
  }

  const id = createId();
  await getPool().query(
    `INSERT INTO "ScrapeJob" ("id","siteKey","mode","totalCodes","doneCodes","failedCodes","startedAt")
     VALUES ($1,$2,$3,$4,0,0,NOW())`,
    [id, siteKey, mode, totalCodes]
  );
  return id;
}

export async function finishJob(
  id: string,
  stats: { done: number; failed: number; error?: string }
): Promise<void> {
  await getPool().query(
    `UPDATE "ScrapeJob"
     SET "doneCodes"=$2, "failedCodes"=$3, "finishedAt"=NOW(), "error"=$4
     WHERE "id"=$1`,
    [id, stats.done, stats.failed, stats.error ?? null]
  );
}

// 청크 진행 상황 저장 — finishJob 전에도 doneCodes/failedCodes 업데이트 가능.
// 배치 중간에 워커가 죽어도 마지막 청크까지의 진행은 보존됨 → healthcheck가 "마지막 배치" 시각으로 인식.
export async function updateJobProgress(
  id: string,
  stats: { done: number; failed: number }
): Promise<void> {
  await getPool().query(
    `UPDATE "ScrapeJob"
     SET "doneCodes"=$2, "failedCodes"=$3
     WHERE "id"=$1`,
    [id, stats.done, stats.failed]
  );
}

// Optional: prune snapshots older than retention window so the table doesn't
// grow unboundedly. Default 14 days — enough to compare today vs. last week.
export async function pruneOldSnapshots(retentionDays = 14): Promise<number> {
  const res = await getPool().query(
    `DELETE FROM "InventorySnapshot" WHERE "scrapedAt" < NOW() - ($1 || ' days')::interval`,
    [String(retentionDays)]
  );
  return res.rowCount ?? 0;
}
