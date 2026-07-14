// 주문 ↔ EP상품 자동매칭 모듈.
//   우선순위: ① 수동매핑(ep_product_map) ② 보험코드 일치(ep_products) ③ 없으면 후보제시/추가실패
const { Pool } = require("pg");
const dbCfg = require("./db.json");

function makePool() {
  return new Pool({ ...dbCfg, max: 1, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });
}

async function ensureMapTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS ep_product_map (
    ykpharm_product_id uuid PRIMARY KEY,
    ep_code text NOT NULL,
    note text,
    mapped_by text,
    mapped_at timestamptz DEFAULT now()
  )`);
}

// 주문의 각 품목을 EP상품으로 해석. 반환: [{qty, yk:{...}, source, ep:{...}|null, candidates:[...]}]
async function resolveOrder(pool, orderId) {
  const items = (await pool.query(
    `SELECT oi.qty, p.id AS yk_id, p.code AS yk_code, p.name AS yk_name, p.spec AS yk_spec, p.coverage
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1 ORDER BY p.name`, [orderId]
  )).rows;

  const out = [];
  for (const it of items) {
    let ep = null, source = null, candidates = [];

    // ① 매핑 테이블 (강제 / 수동매핑)
    const mrow = (await pool.query(`SELECT ep_code, force FROM ep_product_map WHERE ykpharm_product_id=$1`, [it.yk_id])).rows[0];
    if (mrow && mrow.force) {
      // 강제: ep_products 캐시에 없어도 YKPHARM 제품 자체를 EP타겟으로 → 봇이 보험코드로 EP 실시간 검색·매칭
      ep = { ep_code: null, print_name: it.yk_name, spec: it.yk_spec, insurance_code: (it.yk_code || "").trim(), coverage: it.coverage, force: true };
      source = "강제(보험코드)";
    } else if (mrow && mrow.ep_code) {
      const e = (await pool.query(`SELECT * FROM ep_products WHERE ep_code=$1 LIMIT 1`, [mrow.ep_code])).rows[0];
      if (e) { ep = e; source = "수동매핑"; }
    }

    // ② 보험코드 일치
    if (!ep && it.yk_code && it.yk_code.trim()) {
      const byCode = (await pool.query(
        `SELECT * FROM ep_products WHERE insurance_code = $1 LIMIT 1`, [it.yk_code.trim()]
      )).rows[0];
      if (byCode) { ep = byCode; source = "보험코드"; }
    }

    // ③ 후보 제시 (이름 핵심어로 ep_products 검색) — 매칭 실패 시 관리자 드롭다운용
    if (!ep) {
      const core = String(it.yk_name || "").replace(/^\s*퇴장\]\s*/, "").split(/[([_]/)[0].trim();
      if (core) {
        candidates = (await pool.query(
          `SELECT ep_code, print_name, spec, insurance_code, coverage FROM ep_products
           WHERE print_name ILIKE $1 OR name ILIKE $1 ORDER BY print_name LIMIT 10`, ["%" + core + "%"]
        )).rows;
      }
      source = candidates.length ? "매핑필요(후보있음)" : "추가실패(EP에없음)";
    }

    out.push({
      qty: it.qty,
      yk: { id: it.yk_id, code: it.yk_code, name: it.yk_name, spec: it.yk_spec, coverage: it.coverage },
      source,
      ep: ep ? { ep_code: ep.ep_code, print_name: ep.print_name, spec: ep.spec, insurance_code: ep.insurance_code, coverage: ep.coverage } : null,
      candidates,
    });
  }
  return out;
}

module.exports = { makePool, ensureMapTable, resolveOrder };

// 직접 실행 시: 최근 '접수' 주문(또는 인자 UUID) 매칭 미리보기
if (require.main === module) {
  (async () => {
    const pool = makePool();
    await ensureMapTable(pool);
    const oid = process.argv[2] || (await pool.query(
      "SELECT id FROM orders WHERE status='접수' ORDER BY created_at DESC LIMIT 1"
    )).rows[0]?.id;
    if (!oid) { console.log("접수 주문 없음"); await pool.end(); return; }
    console.log("주문:", oid, "\n");
    const res = await resolveOrder(pool, oid);
    for (const r of res) {
      console.log(`■ ${r.yk.name} x${r.qty}  [${r.source}]`);
      if (r.ep) console.log(`    → EP: ${r.ep.print_name} | ${r.ep.spec} | 보험코드 ${r.ep.insurance_code || "없음"}`);
      else if (r.candidates.length) r.candidates.slice(0, 5).forEach((c) => console.log(`    후보: ${c.print_name} | ${c.spec} | ${c.insurance_code || "코드없음"}`));
      else console.log("    → EP에 없음(추가실패)");
    }
    await pool.end();
  })().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
}
