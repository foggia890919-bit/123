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
    // 매 검색마다 폼을 새로 로드한다. 직전 검색이 남긴 hash(#)/스크립트 상태가 페이지에 남으면
    // 재검색 submit 이 발동되지 않고 기본 안내문구("조회 조건을 선택하시고...")만 돌아온다(pageChanged=false).
    // 깨끗한 폼에서 시작하면 이 잔상이 사라지고, 세션이 끊겼으면 /member/ 로 리다이렉트되어
    // scrapeOne 의 다음 getPage 가 isLoggedIn 검사에서 재로그인한다.
    // (이전엔 'order_search 페이지면 재사용'이라, 한번 먹통이 된 페이지가 그대로 굳어 백제만 긁히는 원인이었음)
    await page.goto(SEARCH_URL, { waitUntil: "commit", timeout: 30_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(300);

    // 드롭다운을 "보험코드" 로 강제 — 페이지의 모든 select 를 순회하며
    // "보험코드" 옵션이 있는 element 를 찾아 직접 value 설정 + change 이벤트 발생.
    // 기존 셀렉터 기반 접근이 실패하던 케이스를 우회.
    let selectedValue = "";
    const selectInfo = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll<HTMLSelectElement>("select"));
      for (const sel of selects) {
        const targetOpt = Array.from(sel.options).find(o => o.text.trim() === "보험코드");
        if (!targetOpt) continue;
        sel.value = targetOpt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return { name: sel.name || "(no-name)", value: sel.value, optionText: targetOpt.text };
      }
      // 폴백: 옵션 텍스트에 "보험"이 부분 일치하는 것
      for (const sel of selects) {
        const targetOpt = Array.from(sel.options).find(o => /보험/.test(o.text));
        if (!targetOpt) continue;
        sel.value = targetOpt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return { name: sel.name || "(no-name)", value: sel.value, optionText: targetOpt.text };
      }
      return null;
    }).catch(() => null);
    if (selectInfo) {
      selectedValue = selectInfo.value;
      console.log(`[family] dropdown set — select[name="${selectInfo.name}"] option="${selectInfo.optionText}" value="${selectInfo.value}"`);
    } else {
      console.warn(`[family] dropdown FAILED — no select with "보험코드" option found`);
    }
    await page.waitForTimeout(200);

    const input = await waitAny(page, SEL.searchInput, 20_000);
    await input.click();
    await input.fill(insuranceCode);  // type → fill (타이핑 지연 제거)
    const inputValue = await input.inputValue().catch(() => "");

    // 페이지 변경 감지용 baseline
    const beforeUrl = page.url();
    const beforeBodyLen = await page.evaluate(() => document.body.innerText.length).catch(() => 0);

    // 검색 실행 — 클릭과 form.submit 모두 시도
    const submitInfo = await page.evaluate(() => {
      const results: string[] = [];
      // 1) "조회" 텍스트 element 클릭
      const all = Array.from(document.querySelectorAll<HTMLElement>(
        'button, input[type="button"], input[type="submit"], a, span, div, img'
      ));
      let clicked = false;
      for (const el of all) {
        const txt = ((el as HTMLInputElement).value || el.textContent || el.getAttribute("alt") || "").trim();
        if (!/^조회/.test(txt)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        el.click();
        results.push(`click:${el.tagName}`);
        clicked = true;
        break;
      }
      // 2) form.submit() 도 추가로 — click 만으로 안 먹는 케이스 대비
      const sel = document.querySelector('select[name="selkeyword"]');
      const form = sel?.closest("form") as HTMLFormElement | null;
      if (form) {
        try {
          // 클릭 후 동시 호출은 중복 submit 위험이라, 클릭 성공했으면 form.submit 생략
          if (!clicked) form.submit();
          results.push(`form:${form.name || "(no-name)"}@${form.action || "?"}`);
        } catch (e) {
          results.push(`form-err:${(e as Error).message}`);
        }
      }
      return results.join(" + ");
    }).catch((err) => `error:${(err as Error).message}`);

    // 페이지 변화 대기 — URL 변경 또는 body 길이 변화
    const changed = await page.waitForFunction(
      (args) => {
        const cur = document.body.innerText.length;
        return window.location.href !== args.url || Math.abs(cur - args.len) > 30;
      },
      { url: beforeUrl, len: beforeBodyLen },
      { timeout: 10_000 }
    ).then(() => true).catch(() => false);

    const afterUrl = page.url();
    const afterBodyLen = await page.evaluate(() => document.body.innerText.length).catch(() => 0);
    console.log(`[family] code=${insuranceCode} dropdown="${selectedValue}" input="${inputValue}" submit=${submitInfo} pageChanged=${changed} urlBefore=${beforeUrl.slice(-30)} urlAfter=${afterUrl.slice(-30)} bodyLen=${beforeBodyLen}->${afterBodyLen}`);
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});

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
        { timeout: 5_000 }
      )
      .catch(() => {});
    await page.waitForTimeout(150);

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
      // 검색이 실제로 발동하지 않은(pageChanged=false) 먹통 케이스는 "재고 0"이 아니라 "조회 실패"다.
      // throw 하면 scrapeOne 이 error 로 처리 → 스냅샷 저장 안 함(멀쩡한 값을 0으로 덮지 않음) + 세션 폐기 후 다음 코드는 새 로그인.
      // 반대로 changed=true(검색 실행됨) + 결과 0건 = 진짜 미취급/품절 → [] 반환 → 스케줄러가 0으로 갱신.
      if (!changed) {
        throw new Error(`family search did not execute (pageChanged=false) code=${insuranceCode}`);
      }
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
