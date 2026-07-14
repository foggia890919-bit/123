// 카탈로그 갭 분석(읽기 전용): stock_live(와이케이팜 취급) 의약품 중 YKPHARM products 에 없는 것 추리기.
// 매칭키 = 핵심상품명(공백제거) + 용량숫자 + 용량단위.  결과 → dumps/catalog_gap.json
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const dbCfg = require("./db.json");

const DRUG_KINDS = ["보험(전문)", "보험(일반)", "비보험(전문)", "비보험(일반)", "비보험(기타)"];

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    // 간단 CSV: 모든 필드가 "..."로 감싸짐
    const m = lines[i].match(/"((?:[^"]|"")*)"/g);
    if (!m) continue;
    const f = m.map((x) => x.slice(1, -1).replace(/""/g, '"'));
    rows.push({ code: f[0], name: f[1], spec: f[2], maker: f[3], kind: f[4], stock: f[5] });
  }
  return rows;
}

function coreName(name) {
  let s = String(name || "").replace(/^\((냉|건조|분말|동결|液|액)\)/, "");
  s = s.split(/[(\d]/)[0]; // 첫 '(' 또는 첫 숫자 앞까지
  return s.replace(/\s/g, "");
}
function volKey(spec, name) {
  const src = (spec && /\d/.test(spec)) ? spec : name;
  const m = String(src || "").match(/(\d+(?:\.\d+)?)\s*(ml|mg|g|l|iu|%)/i);
  return m ? m[1] + m[2].toLowerCase() : "";
}
const keyOf = (name, spec) => coreName(name) + "|" + volKey(spec, name);

(async () => {
  const stock = parseCsv(fs.readFileSync(path.join(__dirname, "..", "stock_live.csv"), "utf8"))
    .filter((r) => DRUG_KINDS.includes(r.kind) && r.name);
  console.log(`stock_live 의약품: ${stock.length}건`);

  const pool = new Pool({ ...dbCfg, max: 1, connectionTimeoutMillis: 12000, ssl: { rejectUnauthorized: false } });
  const yk = (await pool.query("SELECT name, spec, code, coverage FROM products")).rows;
  await pool.end();
  console.log(`YKPHARM products: ${yk.length}건`);

  const ykIndex = new Map(); // key → {code}
  for (const p of yk) ykIndex.set(keyOf(p.name, p.spec), p);

  const matched = [], missing = [];
  for (const s of stock) {
    const k = keyOf(s.name, s.spec);
    if (ykIndex.has(k)) matched.push({ ...s, ykCode: ykIndex.get(k).code });
    else missing.push(s);
  }

  console.log(`\n매칭(이미 YKPHARM에 있음): ${matched.length}건`);
  console.log(`누락(YKPHARM에 없음 → 추가 후보): ${missing.length}건`);
  const byKind = {};
  missing.forEach((m) => (byKind[m.kind] = (byKind[m.kind] || 0) + 1));
  console.log("  누락 종류별:", JSON.stringify(byKind));
  console.log("\n=== 누락 후보 샘플 (최대 25) ===");
  missing.slice(0, 25).forEach((m) => console.log(`  [${m.kind}] ${m.name} | ${m.spec} | 표준코드 ${m.code}`));

  fs.writeFileSync(path.join(__dirname, "dumps", "catalog_gap.json"), JSON.stringify({ matchedCount: matched.length, missing }, null, 2));
  console.log(`\n전체 누락 목록 → ep-bot/dumps/catalog_gap.json`);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
