import { Pool } from "pg";
import { hasDb, getPool } from "./db.ts";

// ykpharm-order(Supabase) 재고 내보내기.
// KMD InventorySnapshot 의 도매 재고 합계를 ykpharm-order 의 public.products.stock
// (참고용 재고) 으로 밀어넣는다. 매칭 키: products.code = InventorySnapshot.insuranceCode
// (양쪽 다 9자리 보험코드, 정확 일치만).
//
// 스키마 사실 (C:\temp\ykpharm-order\supabase\schema.sql 에서 확인):
//   - products.code   text    default ''
//   - products.stock  integer NOT NULL default 0
//   - products 에 updated_at 컬럼 없음 (created_at 만 존재) → SET 에서 제외.

let ykPool: Pool | undefined;

function getYkPool(): Pool | null {
  const url = process.env.YKORDER_DATABASE_URL;
  if (!url) return null;
  if (!ykPool) {
    ykPool = new Pool({
      connectionString: url,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return ykPool;
}

export async function exportStockToYkOrder(): Promise<{ matched: number; total: number } | null> {
  const yk = getYkPool();
  if (!yk) {
    console.log("[ykorder] YKORDER_DATABASE_URL 미설정 — 내보내기 건너뜀");
    return null;
  }
  if (!hasDb()) {
    console.log("[ykorder] DATABASE_URL 미설정 — 스냅샷 집계 불가, 내보내기 건너뜀");
    return null;
  }

  // 1) KMD DB: 최근 24시간 스냅샷을 보험코드별 SUM(stock) 으로 집계.
  //    SUM 은 NULL 을 무시하므로 하나라도 숫자면 숫자 합, 전부 NULL 이면 NULL — 요구 semantics 그대로.
  //    NC:% (비급여 의사 키) 는 제외.
  const { rows } = await getPool().query<{ code: string; stock: number | null }>(
    `SELECT "insuranceCode" AS code, SUM("stock")::int AS stock
     FROM "InventorySnapshot"
     WHERE "siteKey" IN ('ibjp','family')
       AND "insuranceCode" NOT LIKE 'NC:%'
       AND "scrapedAt" >= NOW() - INTERVAL '24 hours'
     GROUP BY "insuranceCode"`
  );

  // products.stock 은 NOT NULL — 합계가 NULL(모든 사이트가 재고 미확인)인 코드는 갱신하지 않는다.
  const usable = rows.filter((r): r is { code: string; stock: number } => !!r.code && r.stock !== null);

  // 2) ykorder DB: 500개 청크로 UPDATE ... FROM (VALUES ...).
  //    존재하지 않는 code 는 매칭 실패로 자연히 무시된다.
  let matched = 0;
  const CHUNK = 500;
  for (let i = 0; i < usable.length; i += CHUNK) {
    const slice = usable.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (const r of slice) {
      values.push(r.code, r.stock);
      placeholders.push(`($${p++}::text, $${p++}::int)`);
    }
    const sql = `UPDATE products AS p
      SET stock = v.stock
      FROM (VALUES ${placeholders.join(",")}) AS v(code, stock)
      WHERE p.code = v.code`;
    const res = await yk.query(sql, values);
    matched += res.rowCount ?? 0;
  }

  console.log(`[ykorder] 재고 내보내기 — 스냅샷 ${rows.length} 코드 중 ${matched} 개 반영`);
  return { matched, total: rows.length };
}
