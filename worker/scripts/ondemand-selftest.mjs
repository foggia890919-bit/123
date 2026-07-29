// 온디맨드 큐 수동 테스트 — 큐에 pending 행을 넣고 done 될 때까지 폴링, 소요시간·offer 갱신 확인.
// 서비스 키(RLS 우회)로 insert. 실행: node scripts/ondemand-selftest.mjs [보험코드]
import { readFileSync } from "node:fs";
function parseEnv(p) { const o = {}; for (const l of readFileSync(p, "utf-8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1); o[t.slice(0, e).trim()] = v; } return o; }
const env = parseEnv("C:\\temp\\ykpharm-order\\.env.local");
const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const CODE = process.argv[2] || "698505190";

async function offer(code) { const r = await fetch(`${url}/rest/v1/wholesaler_offers?insurance_code=eq.${code}&select=wholesaler_id,supply_price,discount_rate,stock_qty,uploaded_at`, { headers: H }); return r.ok ? await r.json() : []; }

const before = await offer(CODE);
console.log(`[before] code=${CODE} offers=${JSON.stringify(before)}`);

const ins = await fetch(`${url}/rest/v1/stock_refresh_requests`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ insurance_code: CODE }) });
const [row] = await ins.json();
console.log(`[insert] id=${row.id} status=${row.status} requested_at=${row.requested_at}`);

const t0 = Date.now();
let done = null, lastStatus = "";
for (let i = 0; i < 90; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const r = await fetch(`${url}/rest/v1/stock_refresh_requests?id=eq.${row.id}&select=status,processed_at`, { headers: H });
  const [cur] = await r.json();
  if (cur && cur.status !== lastStatus) { lastStatus = cur.status; console.log(`  +${Math.round((Date.now() - t0) / 1000)}s status=${cur.status}`); }
  if (cur && (cur.status === "done" || cur.status === "failed")) { done = cur; break; }
}
const elapsed = Date.now() - t0;
console.log(`[result] 최종상태=${done?.status ?? "timeout"} 소요=${elapsed}ms`);
const after = await offer(CODE);
console.log(`[after] offers=${JSON.stringify(after)}`);
const changed = JSON.stringify(before) !== JSON.stringify(after);
console.log(`offer 갱신됨=${changed} (uploaded_at 변화로 확인)`);
