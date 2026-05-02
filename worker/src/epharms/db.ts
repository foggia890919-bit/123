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
    .update(`${r.entryDate}|${r.itemName}|${r.sales}|${r.payment}`)
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
  const client = await getPool().connect();
  let inserted = 0;
  try {
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let p = 1;
      for (const r of slice) {
        placeholders.push(
          `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},NOW())`
        );
        values.push(
          createId(), accountId, bizNumber,
          r.entryDate, r.itemName,
          r.sales, r.payment, r.balance,
          rowHash(r)
        );
      }
      const result = await client.query<{ id: string }>(
        `INSERT INTO "LedgerEntry"
           ("id","accountId","bizNumber","entryDate","itemName","sales","payment","balance","rowHash","fetchedAt")
         VALUES ${placeholders.join(",")}
         ON CONFLICT ("accountId","rowHash") DO NOTHING
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
