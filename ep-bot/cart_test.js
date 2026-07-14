// EP 담기 검증: 로그인 → 팝업닫기 → 상품명 검색 → 기준단가코드 일치 행 찾기 →
//   수량 입력 → 담기 → 장바구니 확인. ★ 최종 "선택상품 주문"은 절대 누르지 않음.
// 실행: node ep-bot/cart_test.js [검색어] [타겟코드] [수량]
//   예: node ep-bot/cart_test.js 대한멸균생리식염수 645100582 1
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const OUT = path.join(DIR, "dumps");
fs.mkdirSync(OUT, { recursive: true });
const creds = JSON.parse(fs.readFileSync(path.join(DIR, "ep_login.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TERM = process.argv[2] || "대한멸균생리식염수";
const TARGET_CODE = process.argv[3] || "645100582";
const QTY = process.argv[4] || "1";

async function dismissSwal(page) {
  // sweetalert 확인창 있으면 확인 클릭
  await page.evaluate(() => {
    const b = document.querySelector(".sweet-alert.visible .confirm, .sweet-alert.show .confirm, .sweet-alert .confirm");
    if (b && b.offsetParent !== null) b.click();
  }).catch(() => {});
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 25,
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = (await browser.pages())[0] || (await browser.newPage());
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);

  console.log("1) 로그인");
  await page.goto("https://yk.ep45.co.kr/login", { waitUntil: "domcontentloaded" });
  await page.type("#userId", String(creds.id), { delay: 25 });
  await page.type("#userPwd", String(creds.pw), { delay: 25 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {}),
    page.click("#loginBtn"),
  ]);
  await sleep(3000);

  console.log("2) 팝업 닫기");
  await sleep(1500);
  await page.evaluate(() => {
    document.querySelectorAll(".hd_pops_close").forEach((b) => {
      const pop = b.closest(".hd_pops");
      if (pop && pop.offsetParent !== null) b.click();
    });
  });
  await sleep(800);

  console.log(`3) 상품명 "${TERM}" 검색`);
  await page.click("#pd_name", { clickCount: 3 }).catch(() => {});
  await page.type("#pd_name", TERM, { delay: 25 });
  await Promise.all([
    page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }).catch(() => {}),
    page.click("#btnSrch"),
  ]);
  await sleep(2500);

  // 결과 추출 + 출력
  const rows = await page.$$eval("#itemListBox tr", (trs) =>
    trs.map((tr) => {
      const q = (s) => { const e = tr.querySelector(s); return e ? e.textContent.trim() : null; };
      return { name: q('span[data-name="itemnm"]'), size: q('span[data-name="itemsize"]'), insurecd: q('td[data-name="insurecd"]'), price: q('strong[data-name="pAmt"]') };
    }).filter((r) => r.name)
  );
  console.log(`   결과 ${rows.length}행:`);
  rows.forEach((r) => console.log(`     [${r.insurecd || "코드없음"}] ${r.name} | ${r.size}`));

  console.log(`4) 기준단가코드 ${TARGET_CODE} 행 찾아 수량 ${QTY} 입력 후 담기`);
  const rowHandle = await page.evaluateHandle((code) => {
    const trs = [...document.querySelectorAll("#itemListBox tr")];
    return trs.find((tr) => {
      const c = tr.querySelector('td[data-name="insurecd"]');
      return c && c.textContent.trim() === code;
    }) || null;
  }, TARGET_CODE);

  const row = rowHandle.asElement();
  if (!row) {
    console.log(`   ❌ 코드 ${TARGET_CODE} 행을 현재 페이지에서 못 찾음. (담기 안 함)`);
  } else {
    const qtyInput = await row.$("input.qty");
    await qtyInput.click({ clickCount: 3 });
    await qtyInput.type(String(QTY), { delay: 30 });
    const cartBtn = await row.$("._btnCart");
    await cartBtn.click();
    console.log("   담기 클릭함");
    await sleep(1500);
    await dismissSwal(page);
    await sleep(1500);
  }

  // 장바구니 확인
  const cart = await page.$$eval("#cartListBox tr", (trs) =>
    trs.map((tr) => {
      const q = (s) => { const e = tr.querySelector(s); return e ? e.textContent.trim() : null; };
      const nm = q('td[data-name="itemnm"]');
      const qtyEl = tr.querySelector('input[name="qty"]');
      return nm ? { name: nm, size: q('td[data-name="itemsize"]'), qty: qtyEl ? qtyEl.value : null } : null;
    }).filter(Boolean)
  );
  console.log("\n5) 장바구니 현재 내용:");
  cart.forEach((c) => console.log(`     ${c.name} | ${c.size} | 수량 ${c.qty}`));

  await page.screenshot({ path: path.join(OUT, "cart_test.png"), fullPage: true });
  console.log("\n★ 최종 '선택상품 주문'은 누르지 않았습니다 (실제 발주 안 됨).");
  console.log("  담은 항목은 EP 장바구니에서 '선택상품 비우기'로 지우시면 됩니다.");
  console.log("  스크린샷: dumps/cart_test.png  / 브라우저는 직접 닫으세요.");
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
