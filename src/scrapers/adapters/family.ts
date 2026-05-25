import type { Locator, Page } from "playwright";
import type { Credentials, InventoryItem, WholesaleAdapter } from "../core/types";

// 훼밀리팜 (Family Pharm)
// JSP backend; search page has a dropdown that defaults to something other
// than 보험코드, so we explicitly switch it to 보험코드 before typing.
//
// Confirmed via screenshot:
//   Result table columns: [★] | 보험코드 | 제조원 | 품명 | 구분 | 단가 | 재고 | 수량
//   Login: /member/ (form)
//   Search: /order/order_search.jsp (제품조회 select + input + 조회 button)
//
// Note: site is HTTP only — credentials travel in plaintext.
const SEL = {
  idInput: [
    'input[name="user_id"]',  // family-pharm.co.kr 실제 필드명
    'input[name="id"]',
    'input[name="userId"]',
    'input[name="memberId"]',
    'input[name="mb_id"]',
    'input[type="text"]:not([readonly]):not([disabled])',
  ].join(", "),
  pwInput: [
    'input[name="user_pwd"]',  // family-pharm.co.kr 실제 필드명
    'input[name="pw"]',
    'input[name="passwd"]',
    'input[name="password"]',
    'input[name="userPw"]',
    'input[name="mb_password"]',
    'input[type="password"]',
  ].join(", "),
  // 네비 링크 a:has-text("로그인") 제외 — form 안의 submit 버튼만 타겟
  loginBtn: [
    'form[name="signinFrm"] button[type="submit"]',
    'button.btn--primary[type="submit"]',
    'input[type="submit"][value*="로그인"]',
    'button[type="submit"]',
  ].join(", "),
  searchTypeSelect: [
    'select[name="selkeyword"]',   // family-pharm.co.kr 실제 필드명
    'select[name="searchType"]',
    'select[name="search_type"]',
    'select[name="schType"]',
    'select[name="sType"]',
    'select[name="kind"]',
    'select:has(option:has-text("보험코드"))',
  ].join(", "),
  searchInput: [
    'input[name="keywordtext"]',   // family-pharm.co.kr 실제 필드명
    'input[name="searchKeyword"]',
    'input[name="keyword"]',
    'input[name="searchValue"]',
    'input[name="schValue"]',
    'input[name="schWord"]',
    'input[name="searchWord"]',
  ].join(", "),
  searchBtn: [
    'input[type="button"][value*="조회"]',
    'input[type="submit"][value*="조회"]',
    'button:has-text("조회")',
    'a:has-text("조회")',
    'button.btn-search',
  ].join(", "),
  resultRows:
    'table:has(th:has-text("보험코드")) tbody tr, table:has(th:has-text("보험코드")) tr:has(td)',
};

const SEARCH_URL = "http://family-pharm.co.kr/order/order_search.jsp";

async function waitAny(page: Page, selector: string, timeout = 20_000): Promise<Locator> {
  await page.waitForSelector(selector, { timeout, state: "visible" });
  return page.locator(selector).first();
}

export const family: WholesaleAdapter = {
  key: "family",
  name: "훼밀리팜",
  baseUrl: "http://family-pharm.co.kr",
  loginUrl: "http://family-pharm.co.kr/member/",

  async login(page: Page, creds: Credentials) {
    console.log(`[family] login start — id=${creds.id.slice(0, 3)}***`);
    await page.goto(this.loginUrl, { waitUntil: "commit", timeout: 60_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(800);

    const idInput = await waitAny(page, SEL.idInput);
    const pwInput = await waitAny(page, SEL.pwInput);
    await idInput.fill(creds.id);
    await pwInput.fill(creds.pw);

    const btn = page.locator(SEL.loginBtn).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
    } else {
      await pwInput.press("Enter");
    }
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(800);

    // 로그인 실패 = member 폴더에 그대로 있거나 LoginProcess로 리다이렉트
    const url = page.url();
    const stillOnLogin = /\/member\//i.test(url) || /LoginProcess/i.test(url);
    if (stillOnLogin) {
      // 페이지 안내문구를 같이 잡아서 원인 추적
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const snippet = bodyText.replace(/\s+/g, " ").slice(0, 200);
      console.error(`[family] login FAILED — url=${url} body="${snippet}"`);
      throw new Error(`family login failed — still on login page (${url})`);
    }
    console.log(`[family] login OK — landed on ${url}`);
  },

  async isLoggedIn(page: Page) {
    const url = page.url();
    return !/\/member\//i.test(url) && !/LoginProcess/i.test(url);
  },

  async searchByCode(page: Page, insuranceCode: string): Promise<InventoryItem[]> {
    if (!/order_search/i.test(page.url())) {
      await page.goto(SEARCH_URL, { waitUntil: "commit", timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    // Switch the dropdown to 보험코드 — value, label, evaluate fallback 순으로 시도.
    const select = page.locator(SEL.searchTypeSelect).first();
    let selectedValue = "";
    if (await select.isVisible().catch(() => false)) {
      await select.selectOption({ value: "yakga_cd" }).catch(async () => {
        await select.selectOption({ label: "보험코드" }).catch(async () => {
          await select.evaluate((el: HTMLSelectElement) => {
            const opt = Array.from(el.options).find(o => /보험|yakga|insurance/i.test(o.text + o.value));
            if (opt) {
              el.value = opt.value;
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }).catch(() => {});
        });
      });
      selectedValue = await select.inputValue().catch(() => "");
      await page.waitForTimeout(200);
    }

    const input = await waitAny(page, SEL.searchInput, 20_000);
    await input.click();
    await input.fill("");
    await input.type(insuranceCode, { delay: 30 });
    const inputValue = await input.inputValue().catch(() => "");

    // 검색 버튼 클릭 + Enter 키 둘 다 시도 (안 눌리는 케이스 대비)
    const btn = page.locator(SEL.searchBtn).first();
    const btnVisible = await btn.isVisible().catch(() => false);
    const btnHtml = btnVisible
      ? (await btn.evaluate((el: Element) => el.outerHTML.slice(0, 150)).catch(() => "")).replace(/\s+/g, " ")
      : "";
    console.log(`[family] code=${insuranceCode} dropdown="${selectedValue}" input="${inputValue}" btnVisible=${btnVisible} btn="${btnHtml}"`);
    if (btnVisible) {
      await btn.click().catch(() => {});
    }
    // 항상 Enter 추가 시도 — form submit 보장
    await input.press("Enter").catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

    await page
      .waitForFunction(
        () => {
          const tables = document.querySelectorAll("table");
          for (const t of Array.from(tables)) {
            const ths = t.querySelectorAll("th");
            const isResultTable = Array.from(ths).some(th => /보험코드/.test(th.textContent ?? ""));
            if (!isResultTable) continue;
            const rows = t.querySelectorAll("tbody tr, tr:has(td)");
            return rows.length > 0;
          }
          return false;
        },
        { timeout: 10_000 }
      )
      .catch(() => {});
    await page.waitForTimeout(600);

    const rows = await page.locator(SEL.resultRows).all();
    const items: InventoryItem[] = [];

    // 항상 진단 — 행 수 + 첫 행의 셀 내용까지 같이 찍어서 표 구조 변경/빈 표 모두 추적.
    console.log(`[family] code=${insuranceCode} rows=${rows.length}`);
    if (rows.length > 0) {
      const firstCells = (await rows[0].locator("td").allTextContents()).map(c => c.trim());
      console.log(`[family] code=${insuranceCode} row[0] cells=${JSON.stringify(firstCells)}`);
      if (rows.length > 1) {
        const secondCells = (await rows[1].locator("td").allTextContents()).map(c => c.trim());
        console.log(`[family] code=${insuranceCode} row[1] cells=${JSON.stringify(secondCells)}`);
      }
    }
    if (rows.length === 0) {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const snippet = bodyText.replace(/\s+/g, " ").slice(0, 250);
      const url = page.url();
      console.warn(`[family] code=${insuranceCode} EMPTY rows=0 url=${url} body="${snippet}"`);
    }

    for (const row of rows) {
      const cells = (await row.locator("td").allTextContents()).map(c => c.trim());
      if (cells.length === 0) continue;

      // First cell may be the ★ favourite icon (empty text) — find the
      // insurance code in the first two positions.
      let codeIdx = -1;
      for (let i = 0; i < Math.min(2, cells.length); i++) {
        if (/^\d{9,12}$/.test(cells[i])) {
          codeIdx = i;
          break;
        }
      }
      if (codeIdx === -1) continue;

      const code = cells[codeIdx];
      const rest = cells.slice(codeIdx + 1);
      // After 보험코드: [제조원, 품명, 구분(badges), 단가, 재고, 수량]
      // 구분 column contains badge images that render with no text, so we
      // can't blindly trust positions. Strategy: pick the last 2 numeric
      // cells before 수량 (price + stock).
      const stripBadges = (s: string) =>
        s.replace(/^\d+\.\s*/, "").replace(/^(전문|일반|급여|비급여|전|보)+/g, "").trim();

      const numericIndices = rest
        .map((c, i) => ({ c, i }))
        .filter(x => /^[\d,\s]+$/.test(x.c) && x.c.replace(/[^\d]/g, "").length > 0);
      // Last numeric in row is usually the 수량 input (often empty), so the
      // visible numerics tend to be [price, stock]
      const priceCell = numericIndices[0];
      const stockCell = numericIndices[1];

      const textBeforePrice = rest
        .slice(0, priceCell?.i ?? rest.length)
        .map(c => stripBadges(c))
        .filter(c => c.length > 0 && !/^[\d,\s]+$/.test(c));

      items.push({
        insuranceCode: code,
        productName: textBeforePrice[1] ?? textBeforePrice[0] ?? "",
        spec: null,
        manufacturer: textBeforePrice[0] ?? null,
        unitPrice: priceCell ? Number(priceCell.c.replace(/[^\d]/g, "")) : null,
        stock: stockCell ? Number(stockCell.c.replace(/[^\d]/g, "")) : null,
        raw: { cells },
      });
    }

    // 결과 카운트 1줄 요약 — 항상 출력 (0건도 포함). 0건이면 위 row[0] 로그로 원인 파악.
    console.log(`[family] code=${insuranceCode} DONE items=${items.length}` + (items.length > 0 ? ` firstStock=${items[0].stock}` : ""));
    return items;
  },
};
