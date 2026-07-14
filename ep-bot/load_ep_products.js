// 상품관리.xls → Supabase ep_products 적재 (EP/이팜스 전체상품 카탈로그: 드롭다운/매핑/매칭 소스)
// 실행: node ep-bot/load_ep_products.js [엑셀파일명]
const XLSX = require("xlsx");
const path = require("path");
const { Pool } = require("pg");
const dbCfg = require("./db.json");

const file = process.argv[2] || path.join(__dirname, "..", "상품관리.xls");
const pool = new Pool({ ...dbCfg, max: 1, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });

(async () => {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const header = rows[0].map((h) => String(h).replace(/\s/g, ""));
  const idx = (name) => header.findIndex((h) => h.includes(name));
  const C = {
    code: idx("코드"), maker: idx("제조사"), name: idx("상품명"), print: idx("출력명"), spec: idx("규격"),
    ins: idx("보험코드"), price: idx("보험금액"), cov: idx("급여구분"), rep: idx("대표코드"), std: idx("표준코드"),
    ingrcd: idx("성분코드"), ingrnm: idx("성분명"), device: idx("의료기기여부"), pack: idx("포장정보"),
  };
  const num = (v) => { const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10); return isNaN(n) ? 0 : n; };
  const s = (v) => String(v == null ? "" : v).trim();

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const code = s(r[C.code]);
    if (!code || !/^\d/.test(code)) continue; // 코드 없는/합계행 스킵
    items.push({
      ep_code: code, maker: s(r[C.maker]), name: s(r[C.name]), print_name: s(r[C.print]), spec: s(r[C.spec]),
      insurance_code: s(r[C.ins]), rep_code: s(r[C.rep]), std_code: s(r[C.std]), price: num(r[C.price]),
      coverage: s(r[C.cov]), ingr_code: s(r[C.ingrcd]), ingr_name: s(r[C.ingrnm]),
      is_device: s(r[C.device]) === "Y", pack_info: s(r[C.pack]),
    });
  }

  console.log("파싱된 상품:", items.length);
  console.log("샘플:", JSON.stringify(items[0]));
  const byCov = {}; items.forEach((x) => (byCov[x.coverage] = (byCov[x.coverage] || 0) + 1));
  console.log("급여구분별:", JSON.stringify(byCov));
  console.log("보험코드 있음:", items.filter((x) => x.insurance_code).length, "/ 없음:", items.filter((x) => !x.insurance_code).length);
  console.log("의료기기:", items.filter((x) => x.is_device).length);

  await pool.query(`CREATE TABLE IF NOT EXISTS ep_products (
    ep_code text PRIMARY KEY, maker text, name text, print_name text, spec text,
    insurance_code text, rep_code text, std_code text, price bigint, coverage text,
    ingr_code text, ingr_name text, is_device boolean, pack_info text,
    updated_at timestamptz default now())`);
  await pool.query("CREATE INDEX IF NOT EXISTS ep_products_ins_idx ON ep_products(insurance_code)");
  await pool.query("CREATE INDEX IF NOT EXISTS ep_products_std_idx ON ep_products(std_code)");

  const cols = ["ep_code", "maker", "name", "print_name", "spec", "insurance_code", "rep_code", "std_code", "price", "coverage", "ingr_code", "ingr_name", "is_device", "pack_info"];
  let done = 0;
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200);
    const vals = [], ph = [];
    chunk.forEach((it, k) => {
      const base = k * cols.length;
      ph.push("(" + cols.map((_, j) => `$${base + j + 1}`).join(",") + ")");
      cols.forEach((c) => vals.push(it[c]));
    });
    await pool.query(
      `INSERT INTO ep_products (${cols.join(",")}) VALUES ${ph.join(",")}
       ON CONFLICT (ep_code) DO UPDATE SET ${cols.slice(1).map((c) => `${c}=EXCLUDED.${c}`).join(",")}, updated_at=now()`,
      vals
    );
    done += chunk.length;
  }
  const cnt = await pool.query("SELECT count(*) n FROM ep_products");
  console.log(`적재 완료: ${done}건 upsert / 테이블 총 ${cnt.rows[0].n}건`);
  await pool.end();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
