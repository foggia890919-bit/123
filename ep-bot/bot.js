// EP 발주 봇 핵심 모듈. processOrder(order, opts) 로 호출.
//   order = { login:{id,pw}, items:[{name, code, size, qty}] }
//   opts  = { live, clearCart, headless, keepOpen }
//   반환  = { results, preCart, cart }
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "dumps");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 상품명 → 검색 키워드(핵심 브랜드명): 앞쪽 [..]/퇴장] 제거, 첫 '(' '[' '_' 앞까지
function searchKeyword(name) {
  let s = String(name || "").replace(/^\s*퇴장\]\s*/, "").replace(/^\[[^\]]*\]\s*/, "");
  s = s.split(/[([_]/)[0];
  return s.trim();
}

async function typeSearch(page, kw) {
  await page.click("#pd_name").catch(() => {});
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.evaluate(() => { const e = document.querySelector("#pd_name"); if (e) e.value = ""; });
  await page.type("#pd_name", kw, { delay: 20 });
}

async function dismissSwal(page) {
  await page.evaluate(() => {
    const b = document.querySelector(".sweet-alert .confirm");
    if (b && b.offsetParent !== null) b.click();
  }).catch(() => {});
}

async function extractRows(page) {
  return page.$$eval("#itemListBox tr", (trs) =>
    trs.map((tr) => {
      const q = (s) => { const e = tr.querySelector(s); return e ? e.textContent.trim() : null; };
      return { name: q('span[data-name="itemnm"]'), size: q('span[data-name="itemsize"]'), insurecd: q('td[data-name="insurecd"]') };
    }).filter((r) => r.name)
  );
}

async function readCart(page) {
  return page.$$eval("#cartListBox tr", (trs) =>
    trs.map((tr) => {
      const q = (s) => { const e = tr.querySelector(s); return e ? e.textContent.trim() : null; };
      const nm = q('td[data-name="itemnm"]');
      const qtyEl = tr.querySelector('input[name="qty"]');
      return nm ? { name: nm, size: q('td[data-name="itemsize"]'), qty: qtyEl ? qtyEl.value : null } : null;
    }).filter(Boolean)
  );
}

async function pageNumbers(page) {
  return page.$$eval("#pager a", (as) => as.map((a) => a.textContent.trim()).filter((t) => /^\d+$/.test(t)));
}
async function gotoPage(page, num) {
  const ok = await page.evaluate((n) => {
    const a = [...document.querySelectorAll("#pager a")].find((x) => x.textContent.trim() === String(n));
    if (a) { a.click(); return true; }
    return false;
  }, num);
  if (ok) await sleep(1500);
  return ok;
}

function isMatch(row, item) {
  if (item.code) return row.insurecd === item.code;
  if (item.size) return !row.insurecd && row.size === item.size; // 코드없는 품목만 규격으로
  return false;
}

async function cartCurrentRow(page, item) {
  const handle = await page.evaluateHandle((it) => {
    const trs = [...document.querySelectorAll("#itemListBox tr")];
    return trs.find((tr) => {
      const c = (tr.querySelector('td[data-name="insurecd"]') || {}).textContent?.trim() || "";
      const sz = (tr.querySelector('span[data-name="itemsize"]') || {}).textContent?.trim() || "";
      if (it.code) return c === it.code;
      if (it.size) return !c && sz === it.size;
      return false;
    }) || null;
  }, item);
  const row = handle.asElement();
  if (!row) return false;
  const input = await row.$("input.qty");
  await input.click({ clickCount: 3 });
  await input.type(String(item.qty), { delay: 30 });
  await (await row.$("._btnCart")).click();
  await sleep(1200);
  await dismissSwal(page);
  await sleep(700);
  return true;
}

// 장바구니에서 "우리가 담은 행"만 선택(체크)하고 나머지는 해제. 반환=선택된 행 라벨들.
async function selectOnlyOurs(page, cartedKeys) {
  await page.evaluate(() => document.querySelector("#btnChkAll4D")?.click()); // 전체해제
  await sleep(500);
  return page.evaluate((keys) => {
    const norm = (s) => (s || "").replace(/\s/g, "");
    const out = [];
    document.querySelectorAll("#cartListBox tr").forEach((tr) => {
      const nmEl = tr.querySelector('td[data-name="itemnm"]');
      if (!nmEl) return;
      const name = nmEl.textContent.trim();
      const szEl = tr.querySelector('td[data-name="itemsize"]');
      const size = szEl ? szEl.textContent.trim() : "";
      const mine = keys.some((k) => norm(k.name) === norm(name) && norm(k.size) === norm(size));
      if (mine) {
        const cb = tr.querySelector('input[type=checkbox]');
        if (cb && !cb.checked) cb.click();
        out.push(name + " | " + size);
      }
    });
    return out;
  }, cartedKeys);
}

async function processOrder(order, opts = {}) {
  const { live = false, clearCart = false, headless = false, keepOpen = true } = opts;
  const browser = await puppeteer.launch({ headless, slowMo: 20, defaultViewport: { width: 1440, height: 900 } });
  const page = (await browser.pages())[0] || (await browser.newPage());
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);
  page.on("dialog", async (dialog) => {
    console.log("   [확인창]", dialog.message());
    try { await dialog.accept(); } catch {}
  });

  console.log("로그인:", order.login.id);
  await page.goto("https://yk.ep45.co.kr/login", { waitUntil: "domcontentloaded" });
  await page.type("#userId", String(order.login.id), { delay: 25 });
  await page.type("#userPwd", String(order.login.pw), { delay: 25 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {}),
    page.click("#loginBtn"),
  ]);
  await sleep(3000);
  await sleep(1200);
  await page.evaluate(() => document.querySelectorAll(".hd_pops_close").forEach((b) => { const p = b.closest(".hd_pops"); if (p && p.offsetParent !== null) b.click(); }));
  await sleep(700);

  if (clearCart) {
    console.log("장바구니 비우기");
    await page.evaluate(() => document.querySelector("#btnChkAll4S")?.click());
    await sleep(400);
    await page.evaluate(() => document.querySelector("#btnDelCartItem")?.click());
    await sleep(1500);
  }

  const preCart = await readCart(page);
  if (preCart.length) {
    console.log(`\n⚠ 발주 전 장바구니에 기존 상품 ${preCart.length}건 — 알림 대상(봇은 안 지움):`);
    preCart.forEach((c) => console.log(`   - ${c.name} | ${c.size} | 수량 ${c.qty}`));
  } else {
    console.log("\n발주 전 장바구니 비어있음.");
  }

  const results = [];
  const cartedKeys = []; // 우리가 담은 행(EP 표기 name+size) — 최종주문 시 이것만 선택
  for (const item of order.items) {
    const kw = item.searchTerm || searchKeyword(item.name);
    process.stdout.write(`\n■ "${item.name}" (code=${item.code || "없음"}) → 검색어="${kw}" ... `);
    await typeSearch(page, kw);
    await Promise.all([
      page.waitForNetworkIdle({ idleTime: 700, timeout: 12000 }).catch(() => {}),
      page.click("#btnSrch"),
    ]);
    await sleep(1800);

    let pages = await pageNumbers(page);
    if (!pages.length) pages = ["1"];
    let status = null;
    for (const pn of pages.slice(0, 15)) {
      await gotoPage(page, pn);
      const rows = await extractRows(page);
      const hit = rows.find((r) => isMatch(r, item));
      if (hit) {
        const ok = await cartCurrentRow(page, item);
        if (ok) cartedKeys.push({ name: hit.name, size: hit.size, orderName: item.name, code: item.code, intendedQty: Number(item.qty) });
        status = ok ? `담김 ✅ (${hit.name} | ${hit.size})` : "행 발견했으나 담기 실패";
        break;
      }
    }
    if (!status) {
      const total = (await extractRows(page)).length;
      if (total === 0) status = "미취급(검색결과 0) 🔴";
      else if (!item.code) status = "코드없음→수동확인 🟡";
      else status = "코드 일치행 없음(미취급?) 🔴";
    }
    console.log(status);
    results.push({ name: item.name, code: item.code, qty: item.qty, status });
  }

  const cart = await readCart(page);

  // ── 누락/수량 대사: 주문(기대) vs 실제 담긴 수량 ──
  const norm = (s) => (s || "").replace(/\s/g, "");
  const reconcile = order.items.map((item, i) => {
    const r = results[i] || {};
    const placed = (r.status || "").includes("담김");
    let placedQty = null;
    if (placed) {
      const ck = cartedKeys.find((k) => k.orderName === item.name && k.code === item.code);
      if (ck) {
        const row = cart.find((c) => norm(c.name) === norm(ck.name) && norm(c.size) === norm(ck.size));
        placedQty = row ? Number(row.qty) : null;
      }
    }
    return { name: item.name, code: item.code, intendedQty: Number(item.qty), status: r.status, placedQty, ok: placed && placedQty === Number(item.qty) };
  });
  const allOk = reconcile.length > 0 && reconcile.every((x) => x.ok);

  console.log("\n===== 주문 처리 결과 =====");
  results.forEach((r) => console.log(`  ${r.status.padEnd(22)} | ${r.name} x${r.qty}`));
  if (preCart.length) {
    console.log("\n⚠ 알림 대상 — 발주 전부터 있던 기존 장바구니 상품:");
    preCart.forEach((c) => console.log(`  - ${c.name} | ${c.size} | 수량 ${c.qty}`));
  }
  console.log("\n===== 현재 장바구니(전체) =====");
  cart.forEach((c) => console.log(`  ${c.name} | ${c.size} | 수량 ${c.qty}`));

  console.log("\n===== 대사 (주문수량 vs 담긴수량) =====");
  reconcile.forEach((x) => console.log(`  ${x.ok ? "일치 ✅" : "불일치 ⚠"} | ${x.name} | 주문 ${x.intendedQty} / 담김 ${x.placedQty ?? "-"} | ${x.status}`));
  console.log(allOk ? "→ 전부 일치: 알림 없음(자동 확인 완료)" : "→ 불일치/누락 있음: 카톡 알림 대상 🟡 (관리자 확인)");
  // 최종주문 대비: 우리가 담은 행만 선택(전체해제 → 우리것 체크). 기존/약국 상품은 안 건드림.
  let selected = [];
  if (cartedKeys.length) {
    selected = await selectOnlyOurs(page, cartedKeys);
    console.log(`\n선택(체크)된 우리 주문 행 ${selected.length}개 (이것만 발주됨):`);
    selected.forEach((s) => console.log("  ☑ " + s));
  } else {
    console.log("\n담긴 우리 품목이 없어 선택할 게 없습니다.");
  }

  let placed = false;
  const failedItems = reconcile.filter((x) => !x.ok);
  if (live && !allOk) {
    // ★ 하나라도 담기 실패/수량 불일치면 발주 보류 (부분발주 방지) → 알림으로 관리자 확인
    console.log(`\n⚠ ${failedItems.length}건 담기 실패/수량 불일치 → 발주 보류(주문 안 누름). 실패 품목:`);
    failedItems.forEach((x) => console.log(`   - ${x.name} (주문 ${x.intendedQty} / 담김 ${x.placedQty ?? "없음"})`));
  } else if (live && allOk && selected.length) {
    console.log("\n⚠ LIVE_ORDER → 전 품목 성공 → '선택상품 주문' 클릭 (실제 발주!)");
    await page.evaluate(() => document.querySelector("#btnSelOrder")?.click());
    await sleep(2500);
    await page.screenshot({ path: path.join(OUT, "order_done.png"), fullPage: true });
    placed = true;
    console.log("   ✅ 주문 완료. dumps/order_done.png 확인.");
  } else {
    console.log("\n★ 최종 '선택상품 주문'은 누르지 않았습니다(기본). 실제 발주하려면 LIVE_ORDER=1.");
  }

  fs.writeFileSync(path.join(OUT, "order_result.json"), JSON.stringify({ results, preCart, cart, selected, placed, reconcile, allOk }, null, 2));
  await page.screenshot({ path: path.join(OUT, "place_order.png"), fullPage: true });

  if (!keepOpen) await browser.close();
  return { results, preCart, cart, selected, placed, reconcile, allOk };
}

module.exports = { processOrder, searchKeyword };
