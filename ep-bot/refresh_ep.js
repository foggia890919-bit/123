// EP 카탈로그 자동 갱신: 로그인 → getItemList2 전체 → ep_products upsert.
//   ep_code(=itemid) 기준 병합. 크롤필드(name/print_name/spec/insurance_code/maker/price)만 갱신,
//   엑셀 전용필드(std_code/rep_code/coverage/is_device/ingr_*)는 보존. 신상품은 신규추가.
//   안전장치: 크롤 itemid가 기존 ep_code와 거의 안 겹치면(키 불일치) 덮어쓰지 않고 중단.
// 실행: node ep-bot/refresh_ep.js   (Lightsail에서 cron 으로 주기실행 가능)
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const dbCfg = require("./db.json");
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, "ep_login.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HEADLESS = process.env.HEADLESS === "1";

(async () => {
  const browser = await puppeteer.launch({ headless: HEADLESS ? "new" : false, defaultViewport: { width: 1280, height: 900 } });
  const page = (await browser.pages())[0] || (await browser.newPage());
  page.setDefaultTimeout(30000);
  page.on("dialog", async (d) => { try { await d.accept(); } catch {} });

  console.log("로그인...");
  await page.goto("https://yk.ep45.co.kr/login", { waitUntil: "domcontentloaded" });
  await page.type("#userId", String(creds.id), { delay: 20 });
  await page.type("#userPwd", String(creds.pw), { delay: 20 });
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {}), page.click("#loginBtn")]);
  await sleep(3500);
  await page.evaluate(() => document.querySelectorAll(".hd_pops_close").forEach((b) => { const p = b.closest(".hd_pops"); if (p && p.offsetParent !== null) b.click(); }));
  await sleep(600);

  console.log("EP 상품 페이지네이션 수집 (500개씩)...");
  const ROW = 500;
  let pageNo = 1, items = [];
  while (pageNo <= 60) {
    const d = await page.evaluate((pageNo, rowSize) => new Promise((resolve) => {
      try { IJS.Ajax.send({ url: "/order/getItemList2", params: { srchMod: 0, itempnm: "", itemsize: "", FaCompnm: "", insurecd: "", itemWebGroupId: "", pageNo, rowSize }, success: (r) => resolve(r) }); }
      catch (e) { resolve({ __err: String(e) }); }
      setTimeout(() => resolve({ __timeout: true }), 30000);
    }), pageNo, ROW);
    const arr = Array.isArray(d?.item) ? d.item : (Array.isArray(d?.item?.list) ? d.item.list : null);
    if (!arr) { console.log(`  page ${pageNo} 형식이상:`, JSON.stringify(d).slice(0, 200)); break; }
    items.push(...arr);
    console.log(`  page ${pageNo}: ${arr.length}건 (누적 ${items.length})`);
    if (arr.length < ROW) break;
    pageNo++;
  }
  await browser.close();
  if (!items.length) { console.log("수집 0건 — 중단"); return; }
  console.log("받은 상품:", items.length, "| 필드:", Object.keys(items[0] || {}).join(","));

  const num = (v) => { const n = parseInt(String(v).replace(/[^0-9-]/g, ""), 10); return isNaN(n) ? 0 : n; };
  const s = (v) => String(v == null ? "" : v).trim();
  // itemnm 등에 ♥/이미지(<img base64>) HTML이 섞여올 수 있어 태그 제거
  const clean = (v) => String(v == null ? "" : v).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const rows = items.map((it) => ({
    ep_code: s(it.itemid), name: clean(it.itemnm), print_name: clean(it.itemnm), spec: clean(it.itemsize),
    insurance_code: s(it.insurecd), maker: clean(it.FaCompnm), price: num(it.pAmt),
    std_code: s(it.standardcd), is_device: s(it.udiYN) === "Y",
  })).filter((r) => r.ep_code);

  const pool = new Pool({ ...dbCfg, max: 1, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });

  // 안전장치: 키 겹침 확인
  const codes = rows.map((r) => r.ep_code);
  const overlap = (await pool.query("SELECT count(*) n FROM ep_products WHERE ep_code = ANY($1)", [codes])).rows[0].n;
  const existCnt = (await pool.query("SELECT count(*) n FROM ep_products")).rows[0].n;
  console.log(`키 겹침: 크롤 ${codes.length}개 중 기존 ep_code와 일치 ${overlap}개 (기존 총 ${existCnt})`);
  if (existCnt > 0 && Number(overlap) < 50) {
    console.log("⚠ 겹침이 너무 적음 → itemid 와 ep_code 키 체계가 다를 수 있음. 안전을 위해 갱신 중단.");
    await pool.end();
    return;
  }

  // upsert (크롤 필드만 갱신, 엑셀 전용필드 보존)
  let done = 0, before = existCnt;
  const cols = ["ep_code", "name", "print_name", "spec", "insurance_code", "maker", "price", "std_code", "is_device"];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200), vals = [], ph = [];
    chunk.forEach((it, k) => { const b = k * cols.length; ph.push("(" + cols.map((_, j) => `$${b + j + 1}`).join(",") + ")"); cols.forEach((c) => vals.push(it[c])); });
    await pool.query(
      `INSERT INTO ep_products (${cols.join(",")}) VALUES ${ph.join(",")}
       ON CONFLICT (ep_code) DO UPDATE SET name=EXCLUDED.name, print_name=EXCLUDED.print_name, spec=EXCLUDED.spec,
         insurance_code=EXCLUDED.insurance_code, maker=EXCLUDED.maker, price=EXCLUDED.price,
         std_code=EXCLUDED.std_code, is_device=EXCLUDED.is_device, updated_at=now()`,
      vals
    );
    done += chunk.length;
  }
  const after = (await pool.query("SELECT count(*) n FROM ep_products")).rows[0].n;
  console.log(`갱신 완료: ${done}건 upsert / 신규추가 ${after - before}건 / 총 ${after}건`);
  await pool.end();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
