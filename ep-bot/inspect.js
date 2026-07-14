// EP(yk.ep45.co.kr) 상품검색 화면 구조 인스펙터
// 목적: 로그인 → 상품검색 화면까지 가서 HTML/스크린샷만 저장. 주문은 절대 넣지 않음.
// 실행:  cd C:\Users\김성준\sales  →  node ep-bot/inspect.js
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const OUT = path.join(DIR, "dumps");
fs.mkdirSync(OUT, { recursive: true });
const creds = JSON.parse(fs.readFileSync(path.join(DIR, "ep_login.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dump(page, name) {
  try {
    fs.writeFileSync(path.join(OUT, name + ".html"), await page.content());
  } catch (e) {
    console.log("  main dump err:", e.message);
  }
  const frames = page.frames();
  let i = 0;
  for (const f of frames) {
    try {
      const c = await f.content();
      if (c && c.length > 200) {
        fs.writeFileSync(path.join(OUT, `${name}__frame${i}.html`), `<!-- frame url: ${f.url()} -->\n` + c);
      }
    } catch {}
    i++;
  }
  try {
    await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
  } catch (e) {
    console.log("  screenshot err:", e.message);
  }
  console.log(`  [dump] ${name}  url=${page.url()}  frames=${frames.length}`);
}

// 메인 페이지 + 모든 iframe 에서 fn 실행, 첫 성공 시 true
async function inAnyFrame(page, fn) {
  for (const ctx of [page, ...page.frames()]) {
    try {
      if (await ctx.evaluate(fn)) return true;
    } catch {}
  }
  return false;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 30,
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = (await browser.pages())[0] || (await browser.newPage());
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);

  console.log("1) 로그인 페이지 이동");
  await page.goto("https://yk.ep45.co.kr/login", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  await dump(page, "01_login");

  console.log("2) 아이디/비번 입력 후 로그인");
  await page.type("#userId", String(creds.id), { delay: 30 });
  await page.type("#userPwd", String(creds.pw), { delay: 30 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {}),
    page.click("#loginBtn"),
  ]);
  await sleep(3500);
  await dump(page, "02_after_login");

  console.log("3) '배송일정 안내' 팝업 닫기 시도");
  await inAnyFrame(page, () => {
    const els = [...document.querySelectorAll("button, a, input[type=button], span, div")];
    const close = els.find((e) => ((e.innerText || e.value || "").trim()) === "닫기");
    if (close) { close.click(); return true; }
    return false;
  });
  await sleep(1200);

  console.log("4) '상품검색' 메뉴 클릭 시도");
  await inAnyFrame(page, () => {
    const els = [...document.querySelectorAll("a, button, span, li, div")];
    const t = els.find((e) => ((e.innerText || "").trim()) === "상품검색");
    if (t) { t.click(); return true; }
    return false;
  });
  await sleep(3000);
  await dump(page, "03_product_search");

  console.log('5) 상품명 "대한멸균생리식염수" 검색 시도 (best-effort, 주문 아님)');
  const searched = await inAnyFrame(page, () => {
    let input = document.querySelector('input[title*="상품명"], input[placeholder*="상품명"]');
    if (!input) {
      const cands = [...document.querySelectorAll("input[type=text]")].filter((i) => i.offsetParent !== null);
      input = cands[0];
    }
    if (!input) return false;
    input.focus();
    input.value = "대한멸균생리식염수";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const btn = [...document.querySelectorAll("button, a, input[type=button], input[type=submit]")]
      .find((b) => ((b.innerText || b.value || "")).includes("검색"));
    if (btn) { btn.click(); return true; }
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
    return true;
  });
  console.log("   검색 시도 결과:", searched);
  await sleep(4000);
  await dump(page, "04_search_results");

  console.log("\n=== 완료 ===");
  console.log("결과 파일 폴더:", OUT);
  console.log("주문은 전혀 넣지 않았습니다. 브라우저는 열어뒀으니 직접 확인 후 닫으세요.");
  console.log("(이 창을 닫거나 터미널에서 Ctrl+C 하면 종료됩니다)");
  // 브라우저를 일부러 닫지 않음 — 사용자가 눈으로 확인하도록
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
