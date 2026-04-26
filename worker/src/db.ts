import { Pool } from "pg";
import { createId } from "@paralleldrive/cuid2";
import type { InventoryItem } from "../../src/scrapers/core/types.ts";

// Worker uses pg directly (no Prisma). All schemas mirror prisma/schema.prisma.
// IDs are generated client-side as cuid2 to match Prisma's @default(cuid()) behavior
// (cuid2 is the modern replacement; same alphabet rules).

const url = process.env.DATABASE_URL;

let pool: Pool | undefined;

export function hasDb(): boolean {
  return !!url;
}

function getPool(): Pool {
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

export interface ExcelMedRow {
  insuranceCode: string;
  productName: string;
}

// Returns deduped list of insurance codes from Excel-uploaded medications
// (the "요율표" — what users uploaded as their commission rate sheet).
export async function loadExcelMedicationCodes(): Promise<ExcelMedRow[]> {
  const { rows } = await getPool().query<{ insuranceCode: string; productName: string }>(
    `SELECT DISTINCT ON ("insuranceCode") "insuranceCode", "productName"
     FROM "Medication"
     WHERE "source" = 'EXCEL'
       AND "insuranceCode" IS NOT NULL
       AND "insuranceCode" <> ''
     ORDER BY "insuranceCode", "createdAt" DESC`
  );
  return rows;
}

export interface SnapshotInsert {
  siteKey: string;
  insuranceCode: string;
  item: InventoryItem;
}

export async function saveSnapshots(rows: SnapshotInsert[]): Promise<number> {
  if (rows.length === 0) return 0;
  const client = await getPool().connect();
  try {
    // Batch insert in chunks of 500 to keep parameter count under postgres limit (65k)
    const CHUNK = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let p = 1;
      for (const r of slice) {
        const id = createId();
        values.push(
          id,
          r.siteKey,
          r.item.insuranceCode || r.insuranceCode,
          r.item.productName,
          r.item.spec ?? null,
          r.item.manufacturer ?? null,
          r.item.unitPrice ?? null,
          r.item.stock ?? null,
          r.item.raw ? JSON.stringify(r.item.raw) : null,
        );
        placeholders.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, NOW())`
        );
      }
      const sql = `INSERT INTO "InventorySnapshot"
        ("id","siteKey","insuranceCode","productName","spec","manufacturer","unitPrice","stock","raw","scrapedAt")
        VALUES ${placeholders.join(",")}`;
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

// Optional: prune snapshots older than retention window so the table doesn't
// grow unboundedly. Default 14 days — enough to compare today vs. last week.
export async function pruneOldSnapshots(retentionDays = 14): Promise<number> {
  const res = await getPool().query(
    `DELETE FROM "InventorySnapshot" WHERE "scrapedAt" < NOW() - ($1 || ' days')::interval`,
    [String(retentionDays)]
  );
  return res.rowCount ?? 0;
}
