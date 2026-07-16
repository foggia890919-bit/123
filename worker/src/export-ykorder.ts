import { readFileSync, existsSync } from "node:fs";
import { hasDb, getPool } from "./db.ts";

// ykpharm-order(Supabase) 재고 내보내기 — Supabase REST(PostgREST) 방식.
// KMD InventorySnapshot 의 도매 재고 합계를 ykpharm-order 의 public.products.stock
// (참고용 재고) 으로 밀어넣는다. 매칭 키: products.code = InventorySnapshot.insuranceCode
// (양쪽 다 보험코드, 정확 일치만).
//
// 왜 Postgres 직결이 아니라 REST 인가:
//   직결용 YKORDER_DATABASE_URL 이 없어 이 모듈이 오래 잠자고 있었다. ykpharm-order 의
//   service_role 키(sb_secret_…)는 확보돼 있어 REST(PATCH)로 바로 가동할 수 있다.
//
// 반영 방식 — code 단위 개별 PATCH (upsert_products RPC 를 쓰지 않는 이유):
//   ykpharm-order 의 upsert_products RPC 는 stock 만 넘겨도
//     (a) code 가 products 에 없으면 INSERT 를 시도한다. name 은 NOT NULL 인데 우리가
//         name 을 안 보내므로 제약 위반으로 그 500-청크 전체가 실패한다.
//     (b) 매칭된 행 중 (비급여 · cost_price>0 · base_price=0) 인 것은 base_price 를
//         자동으로 round(cost_price*1.2) 로 덮어쓴다.  → stock 외 다른 필드가 바뀐다.
//   즉 RPC 는 "stock 외 필드 불변" 을 보장하지 못한다.
//   반면 PATCH /rest/v1/products?code=eq.<code> body {stock} 는:
//     - stock 컬럼 하나만 갱신(다른 필드는 절대 건드리지 않음),
//     - 존재하지 않는 code 는 0행 매칭 → 조용히 무시(INSERT 안 함, 에러 없음),
//     - service_role 키라 RLS(관리자 전용 products_write) 를 우회한다.
//   그래서 사전 교집합 계산 없이도 태생적으로 안전하다.
//
// service key 는 어떤 로그에도 출력하지 않는다(URL·헤더도 로그 금지).

// sync_drug_master.js / .github/workflows/drug-sync.yml 의 SUPABASE_URL 상수와 동일.
// .env.local 에 SUPABASE_URL 이 있으면 그 값을 우선 쓰고, 없을 때 이 상수로 폴백.
const DEFAULT_URL = "https://sixujzpkxamkfjasexbj.supabase.co";
const DEFAULT_ENV_PATH = "C:\\temp\\ykpharm-order\\.env.local";

interface YkConfig {
  url: string;
  key: string;
}

// .env.local 을 KEY=VALUE 로 파싱 (주석/빈 줄 무시, 양끝 따옴표 제거, 값 안의 '=' 허용).
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

// 설정 해석 우선순위:
//   1) env YKORDER_SUPABASE_URL / YKORDER_SERVICE_KEY
//   2) YKORDER_ENV_PATH(기본 C:\temp\ykpharm-order\.env.local)의
//      SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//   url 은 어느 경로든 없으면 DEFAULT_URL 로 폴백. key 를 끝내 못 찾으면 null(→ no-op).
function resolveConfig(): YkConfig | null {
  const envUrl = process.env.YKORDER_SUPABASE_URL;
  const envKey = process.env.YKORDER_SERVICE_KEY;
  if (envKey) {
    return { url: normalizeUrl(envUrl || DEFAULT_URL), key: envKey };
  }

  const envPath = process.env.YKORDER_ENV_PATH || DEFAULT_ENV_PATH;
  if (!existsSync(envPath)) return null;
  const parsed = parseEnvFile(envPath);
  const key = parsed.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return { url: normalizeUrl(envUrl || parsed.SUPABASE_URL || DEFAULT_URL), key };
}

function normalizeUrl(u: string): string {
  return u.replace(/\/+$/, "");
}

export async function exportStockToYkOrder(): Promise<{ matched: number; total: number } | null> {
  const cfg = resolveConfig();
  if (!cfg) {
    console.log(
      "[ykorder] Supabase 설정 없음 (YKORDER_SERVICE_KEY 또는 .env.local 의 SUPABASE_SERVICE_ROLE_KEY) — 내보내기 건너뜀"
    );
    return null;
  }
  if (!hasDb()) {
    console.log("[ykorder] DATABASE_URL 미설정 — 스냅샷 집계 불가, 내보내기 건너뜀");
    return null;
  }

  // 1) KMD DB: 최근 24시간 스냅샷을 보험코드별 SUM(stock) 으로 집계 (기존 로직 유지).
  //    SUM 은 NULL 을 무시하므로 하나라도 숫자면 숫자 합, 전부 NULL 이면 NULL.
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
  const usable = rows.filter(
    (r): r is { code: string; stock: number } => !!r.code && r.stock !== null
  );

  // 2) Supabase REST: code 단위 PATCH 로 stock 만 갱신.
  //    500개 청크로 나눠 진행, 청크 안에서는 동시성 제한으로 병렬 처리.
  const restBase = `${cfg.url}/rest/v1/products`;
  const headers: Record<string, string> = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    "Content-Type": "application/json",
    // 갱신된 행만 되돌려받아(select=code) 반영 건수를 센다.
    Prefer: "return=representation",
  };

  let matched = 0;
  let firstError: string | null = null;
  const CHUNK = 500;
  const CONCURRENCY = 12;

  for (let i = 0; i < usable.length; i += CHUNK) {
    const slice = usable.slice(i, i + CHUNK);
    let idx = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, slice.length) }, async () => {
        while (idx < slice.length) {
          const r = slice[idx++];
          const url = `${restBase}?code=eq.${encodeURIComponent(r.code)}&select=code`;
          try {
            const res = await fetch(url, {
              method: "PATCH",
              headers,
              body: JSON.stringify({ stock: r.stock }),
            });
            if (!res.ok) {
              // 응답 본문은 PostgREST 에러 JSON(키 미포함)이라 로그에 안전.
              const body = await res.text();
              if (!firstError) firstError = `HTTP ${res.status}: ${body.slice(0, 160)}`;
              continue;
            }
            const updated = (await res.json()) as unknown;
            if (Array.isArray(updated)) matched += updated.length;
          } catch (e) {
            if (!firstError) firstError = (e as Error).message;
          }
        }
      })
    );
  }

  if (firstError) {
    console.warn(`[ykorder] 일부 PATCH 실패 (첫 오류): ${firstError}`);
  }
  console.log(`[ykorder] 재고 내보내기 — 스냅샷 ${rows.length} 코드 중 ${matched} 개 반영`);
  return { matched, total: rows.length };
}
