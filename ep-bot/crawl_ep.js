// EP 전체 상품 카탈로그 크롤(읽기 전용): 로그인 → getItemList2 를 rowSize 크게 호출 → 전체 상품 JSON 저장.
// 결과 → dumps/ep_catalog.json (드롭다운/매핑/자동매칭 기반 데이터)
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const creds = JSON.parse(fs.readFileSync(path.join(__dirname, "ep_login.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(__dirname, "dumps");

(async () => {
  const browser = await puppeteer.launch({ headless: false, defaultViewport: { width: 1280, height: 900 } });
  const page = (await browser.pages())[0] || (await browser.newPage());
  page.setDefaultTimeout(30000);
  page.on("dialog", async (d) => { try { await d.accept(); } catch {} });

  console.log("로그인...");
  await page.goto("https://yk.ep45.co.kr/login", { waitUntil: "domcontentloaded" });
  await page.type("#userId", String(creds.id), { delay: 25 });
  await page.type("#userPwd", String(creds.pw), { delay: 25 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {}),
    page.click("#loginBtn"),
  ]);
  await sleep(3500);
  await page.evaluate(() => document.querySelectorAll(".hd_pops_close").forEach((b) => { const p = b.closest(".hd_pops"); if (p && p.offsetParent !== null) b.click(); }));
  await sleep(800);

  console.log("전체 상품 요청 (getItemList2, rowSize 100000)...");
  const data = await page.evaluate(() => new Promise((resolve) => {
    try {
      IJS.Ajax.send({
        url: "/order/getItemList2",
        params: { srchMod: 0, itempnm: "", itemsize: "", FaCompnm: "", insurecd: "", itemWebGroupId: "", pageNo: 1, rowSize: 100000 },
        success: (resData) => resolve(resData),
      });
    } catch (e) { resolve({ __err: String(e) }); }
    setTimeout(() => resolve({ __timeout: true }), 90000);
  }));

  console.log("응답 keys:", data && typeof data === "object" ? Object.keys(data).join(",") : typeof data);
  let items = null;
  if (data && Array.isArray(data.item)) items = data.item;
  else if (data && data.item && Array.isArray(data.item.list)) items = data.item.list;
  else if (Array.isArray(data)) items = data;

  fs.writeFileSync(path.join(OUT, "ep_catalog_raw.json"), JSON.stringify(data, null, 2).slice(0, 5_000_000));
  if (!items) {
    console.log("상품 배열 위치를 못 찾음. ep_catalog_raw.json 앞부분 확인 필요.");
    console.log(JSON.stringify(data).slice(0, 500));
    await browser.close();
    return;
  }
  console.log("받은 상품 수:", items.length);
  console.log("필드 샘플:", JSON.stringify(items[0]));
  fs.writeFileSync(path.join(OUT, "ep_catalog.json"), JSON.stringify(items, null, 2));
  console.log("저장: dumps/ep_catalog.json");
  await browser.close();
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
