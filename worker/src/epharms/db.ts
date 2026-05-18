// ePharms 동기화 전용 DB 헬퍼. worker는 pg 직접 사용 (Prisma X).

import { Pool } from "pg";
import { createId } from "@paralleldrive/cuid2";
import { createHash, createDecipheriv } from "crypto";
import type { LedgerRow } from "./adapter.ts";

const url = process.env.DATABASE_URL;
let pool: Pool | undefined;

function getPool(): Pool {
  if (!url) throw new Error("DATABASE_URL not set");
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 30_000 });
  }
  return pool;
}

// =====================================================================
// 상품 마스터 — paginated scrape용 헬퍼
// =====================================================================

export interface ProductRow {
  priceCode: string;
  productName: string;
  manufacturer: string;
  spec?: string | null;
  basePrice?: number;
}

export async function startProductSyncLog(triggeredBy: string | null): Promise<string> {
  const id = createId();
  await getPool().query(
    `INSERT INTO "ProductSyncLog" ("id","triggeredBy","status","source","startedAt","rowsTotal","rowsInserted","rowsUpdated")
     VALUES ($1,$2,'running','worker-scrape',NOW(),0,0,0)`,
    [id, triggeredBy]
  );
  return id;
}

export async function updateProductSyncLogProgress(
  logId: string,
  rowsTotal: number,
  rowsInserted: number,
  rowsUpdated: number
): Promise<void> {
  await getPool().query(
    `UPDATE "ProductSyncLog" SET "rowsTotal"=$1,"rowsInserted"=$2,"rowsUpdated"=$3 WHERE "id"=$4`,
    [rowsTotal, rowsInserted, rowsUpdated, logId]
  );
}

export async function finishProductSyncLog(
  logId: string,
  result: { status: "ok" | "error"; rowsTotal: number; rowsInserted: number; rowsUpdated: number; error?: string }
): Promise<void> {
  await getPool().query(
    `UPDATE "ProductSyncLog"
        SET "status"=$1,"finishedAt"=NOW(),"rowsTotal"=$2,"rowsInserted"=$3,"rowsUpdated"=$4,"errorMsg"=$5
      WHERE "id"=$6`,
    [result.status, result.rowsTotal, result.rowsInserted, result.rowsUpdated, result.error ?? null, logId]
  );
}

/** 페이지에서 긁은 상품들을 priceCode 기준 upsert. (inserted, updated) 반환. */
export async function upsertProducts(rows: ProductRow[]): Promise<{ inserted: number; updated: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };
  const client = await getPool().connect();
  let inserted = 0, updated = 0;
  try {
    // 일괄 upsert + RETURNING xmax (=0이면 INSERT, !=0이면 UPDATE)
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (const r of rows) {
      placeholders.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},NOW(),NOW())`
      );
      values.push(
        createId(),
        r.priceCode,
        r.productName,
        r.manufacturer,
        r.spec ?? null,
        r.basePrice ?? 0
      );
    }
    const result = await client.query<{ xmax: string }>(
      `INSERT INTO "EpharmsProduct"
         ("id","priceCode","productName","manufacturer","spec","basePrice","createdAt","updatedAt")
       VALUES ${placeholders.join(",")}
       ON CONFLICT ("priceCode") DO UPDATE SET
         "productName"  = EXCLUDED."productName",
         "manufacturer" = EXCLUDED."manufacturer",
         "spec"         = EXCLUDED."spec",
         "basePrice"    = EXCLUDED."basePrice",
         "active"       = true,
         "fetchedAt"    = NOW(),
         "updatedAt"    = NOW()
       RETURNING xmax::text AS xmax`,
      values
    );
    for (const row of result.rows) {
      if (row.xmax === "0") inserted++;
      else updated++;
    }
  } finally {
    client.release();
  }
  return { inserted, updated };
}

// =====================================================================
// 매출원장 (기존)
// =====================================================================

export interface AccountRow {
  id: string;
  bizNumber: string;
  clientName: string;
  loginId: string;
  loginPwEnc: string;
}

export async function loadActiveAccounts(): Promise<AccountRow[]> {
  const { rows } = await getPool().query<AccountRow>(
    `SELECT "id","bizNumber","clientName","loginId","loginPwEnc"
       FROM "EpharmsAccount"
      WHERE "active" = true
      ORDER BY "createdAt" ASC`
  );
  return rows;
}

function loadKey(): Buffer {
  const raw = process.env.EPHARMS_ENC_KEY;
  if (!raw) throw new Error("EPHARMS_ENC_KEY env var is required");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("EPHARMS_ENC_KEY must decode to 32 bytes");
  return buf;
}

export function decryptPw(stored: string): string {
  const key = loadKey();
  const [ivB64, tagB64, encB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("malformed encrypted secret");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const enc = Buffer.from(encB64, "base64");
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

function rowHash(r: LedgerRow): string {
  return createHash("sha1")
    .update(`${r.entryDate}|${r.ediCode}|${r.itemName}|${r.sales}`)
    .digest("hex");
}

export async function startSyncLog(accountId: string): Promise<string> {
  const id = createId();
  await getPool().query(
    `INSERT INTO "LedgerSyncLog" ("id","accountId","status","startedAt","rowsFetched","rowsInserted")
     VALUES ($1,$2,'running',NOW(),0,0)`,
    [id, accountId]
  );
  return id;
}

export async function finishSyncLog(
  logId: string,
  accountId: string,
  result: { status: "ok" | "error"; rowsFetched: number; rowsInserted: number; error?: string }
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE "LedgerSyncLog"
          SET "finishedAt"=NOW(),"status"=$1,"rowsFetched"=$2,"rowsInserted"=$3,"errorMsg"=$4
        WHERE "id"=$5`,
      [result.status, result.rowsFetched, result.rowsInserted, result.error ?? null, logId]
    );
    await client.query(
      `UPDATE "EpharmsAccount"
          SET "lastSyncedAt"=NOW(),"lastSyncStatus"=$1,"lastSyncError"=$2,"updatedAt"=NOW()
        WHERE "id"=$3`,
      [result.status, result.error ?? null, accountId]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function upsertLedgerRows(
  accountId: string,
  bizNumber: string,
  rows: LedgerRow[]
): Promise<number> {
  if (rows.length === 0) return 0;

  // 같은 배치 내 rowHash 중복 제거 — ON CONFLICT DO UPDATE는 동일 행을 두 번 건드릴 수 없음
  const seen = new Map<string, LedgerRow>();
  for (const r of rows) seen.set(rowHash(r), r);
  const deduped = Array.from(seen.values());

  const client = await getPool().connect();
  let inserted = 0;
  try {
    const CHUNK = 200;
    for (let i = 0; i < deduped.length; i += CHUNK) {
      const slice = deduped.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let p = 1;
      for (const r of slice) {
        placeholders.push(
          `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},NOW())`
        );
        values.push(
          createId(), accountId, bizNumber,
          r.entryDate, r.ediCode || null, r.itemName,
          r.spec || null, r.quantity || null, r.unitPrice || null,
          r.sales, r.payment, r.balance,
          rowHash(r)
        );
      }
      const result = await client.query<{ id: string }>(
        `INSERT INTO "LedgerEntry"
           ("id","accountId","bizNumber","entryDate","ediCode","itemName","spec","quantity","unitPrice","sales","payment","balance","rowHash","fetchedAt")
         VALUES ${placeholders.join(",")}
         ON CONFLICT ("accountId","rowHash") DO UPDATE SET
           "ediCode"   = EXCLUDED."ediCode",
           "spec"      = EXCLUDED."spec",
           "quantity"  = EXCLUDED."quantity",
           "unitPrice" = EXCLUDED."unitPrice",
           "sales"     = EXCLUDED."sales",
           "payment"   = EXCLUDED."payment",
           "balance"   = EXCLUDED."balance",
           "fetchedAt" = NOW()
         RETURNING "id"`,
        values
      );
      inserted += result.rowCount ?? 0;
    }
    return inserted;
  } finally {
    client.release();
  }
}
