// EP 검색·매칭 검증: 로그인 → 팝업닫기 → 상품명 검색 → 결과행에서 기준단가코드 추출.
// 담기/주문은 절대 하지 않음.
// 실행: node ep-bot/search_test.js [검색어] [타겟코드]
//   예: node ep-bot/search_test.js 대한멸균생리식염수 645100582
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

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 20,
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

  console.log("2) 팝업 닫기 (보이는 팝업만)");
  await sleep(1500); // 팝업이 늦게 뜨므로 대기
  const closed = await page.evaluate(() => {
    let n = 0;
    document.querySelectorAll(".hd_pops_close").forEach((b) => {
      const pop = b.closest(".hd_pops");
      if (pop && pop.offsetParent !== null) { b.click(); n++; }
    });
    return n;
  });
  console.log("   닫은 팝업 수:", closed);
  await sleep(800);

  console.log(`3) 상품명 "${TERM}" 검색`);
  await page.click("#pd_name", { clickCount: 3 }).catch(() => {});
  await page.type("#pd_name", TERM, { delay: 25 });
  await Promise.all([
    page.waitForNetworkIdle({ idleTime: 800, timeout: 15000 }).catch(() => {}),
    page.click("#btnSrch"),
  ]);
  await sleep(2500);
  await page.screenshot({ path: path.join(OUT, "search_result.png"), fullPage: true });

  console.log("4) 결과행 추출");
  const rows = await page.$$eval("#itemListBox tr", (trs) =>
    trs
      .map((tr) => {
        const q = (sel) => {
          const e = tr.querySelector(sel);
          return e ? e.textContent.trim() : null;
        };
        return {
          maker: q('td[data-name="FaCompnm"]'),
          name: q('span[data-name="itemnm"]'),
          size: q('span[data-name="itemsize"]'),
          insurecd: q('td[data-name="insurecd"]'),
          price: q('strong[data-name="pAmt"]'),
          stock: q('td[data-name="qty"]'),
        };
      })
      .filter((r) => r.name)
  );
  fs.writeFileSync(path.join(OUT, "search_result.json"), JSON.stringify(rows, null, 2));

  console.log(`\n검색어="${TERM}" → 결과 ${rows.length}행:`);
  rows.forEach((r) =>
    console.log(`  [${r.insurecd || "코드없음"}] ${r.name} | ${r.size} | 단가 ${r.price} | 재고 ${r.stock}`)
  );
  const hit = rows.find((r) => r.insurecd === TARGET_CODE);
  console.log(
    `\n타겟코드 ${TARGET_CODE} → ${hit ? `✅ 매칭: ${hit.name} (${hit.size})` : "❌ 결과에 없음"}`
  );
  console.log("\n주문/담기는 하지 않았습니다. 결과는 dumps/search_result.json 에 저장. 브라우저는 직접 닫으세요.");
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
