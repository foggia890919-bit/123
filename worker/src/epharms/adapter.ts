// ePharms (yk.ep45.co.kr) 매출원장 스크래퍼
//
// 화면 확인:
//   원장상세: https://yk.ep45.co.kr/account/account_detail
//   컬럼: 명세일자 | EDI | 제품명 | 규격 | 수량 | 단가 | 합계 | 수금 | 잔액 | 제조번호 | 유효기간 | 비고
//   조회기간: 시작일 ~ 종료일 + "검색" 버튼
//   상단: 메뉴 좌측 사이드바 → 장부 > 원장상세

import type { Page } from "playwright";

export interface EpharmsCreds {
  loginId: string;
  loginPw: string;
}

export interface LedgerRow {
  entryDate: string;   // YYYY-MM-DD (명세일자)
  ediCode: string;     // EDI 코드
  itemName: string;    // 제품명
  spec: string;        // 규격
  quantity: number;    // 수량
  unitPrice: number;   // 단가
  sales: number;       // 합계 (quantity × unitPrice)
  payment: number;     // 수금
  balance: number;     // 잔액
}

const BASE = "https://yk.ep45.co.kr";

const SEL = {
  // ----- 로그인 (확정: 2026-05 사장님 outerHTML 검증) -----
  idInput:    '#userId',
  pwInput:    '#userPwd',
  loginBtn:   '#loginBtn',
  // ----- 원장상세 -----
  // 1년 빠른선택 버튼 (원장집계와 동일한 selector)
  periodYearBtn: 'button.PeriodBtn[data-periodtyp="Y"][data-periodnum="1"]',
  // 백업: 직접 날짜 인풋 조작
  dateFromInput: '#search_pd_start',
  dateToInput:   '#search_pd_end',
  searchBtn:     '#btnSrch',
  // 결과 테이블: 명세일자 헤더가 있는 테이블의 tbody tr
  resultRows:    'table:has(th:has-text("명세일자")) tbody tr',
};

const LOGIN_URL  = `${BASE}/`;
const LEDGER_URL = `${BASE}/account/account_detail`;

function parseMoney(s: string): number {
  // "7,000" → 7000, "" → 0, "-1,000" → -1000
  const cleaned = (s || "").replace(/[^\d-]/g, "");
  if (!cleaned || cleaned === "-") return 0;
  return Number(cleaned);
}

function parseDate(s: string): string | null {
  const t = (s || "").trim();
  const m = t.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!m) return null;
  const yyyy = m[1];
  const mm = m[2].padStart(2, "0");
  const dd = m[3].padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function login(page: Page, creds: EpharmsCreds): Promise<void> {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(500);

  const pwVisible = await page.locator(SEL.pwInput).first().isVisible().catch(() => false);
  if (!pwVisible) return;

  await page.locator(SEL.idInput).first().fill(creds.loginId);
  await page.locator(SEL.pwInput).first().fill(creds.loginPw);

  const btn = page.locator(SEL.loginBtn).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
  } else {
    await page.locator(SEL.pwInput).first().press("Enter");
  }

  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);

  if (await page.locator(SEL.pwInput).first().isVisible().catch(() => false)) {
    throw new Error("ePharms 로그인 실패: 로그인 후에도 PW 인풋이 보임 (ID/PW 확인 필요)");
  }
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  return !(await page.locator(SEL.pwInput).first().isVisible().catch(() => false));
}

/** 원장상세에서 최근 1년치 개별 명세 행을 긁는다. */
export async function fetchLedger(page: Page): Promise<LedgerRow[]> {
  await page.goto(LEDGER_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(800);

  // "1년" 빠른선택 버튼 클릭
  const yearBtn = page.locator(SEL.periodYearBtn).first();
  if (await yearBtn.count() > 0) {
    await yearBtn.click();
    console.log('[ePharms] clicked "1년" period button');
    await page.waitForTimeout(500);
  } else {
    console.warn('[ePharms] "1년" period button not found — falling back to default page state');
  }

  // 검색 버튼 클릭
  const sBtn = page.locator(SEL.searchBtn).first();
  if (await sBtn.isVisible().catch(() => false)) {
    await sBtn.click();
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);

  // 결과 테이블 파싱 — page.evaluate로 한 번에 처리 (행별 IPC 왕복 제거)
  // account_detail 컬럼: [0]명세일자 [1]EDI [2]제품명 [3]규격 [4]수량 [5]단가 [6]합계 [7]수금 [8]잔액 [9]제조번호 [10]유효기간 [11]비고
  const out: LedgerRow[] = await page.evaluate((selector) => {
    function parseMon(s: string) {
      const c = (s || "").replace(/[^\d-]/g, "");
      if (!c || c === "-") return 0;
      return Number(c) || 0;
    }
    function parseDt(s: string) {
      const m = (s || "").trim().match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
      if (!m) return null;
      return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    }
    const result: Array<{
      entryDate: string; ediCode: string; itemName: string;
      spec: string; quantity: number; unitPrice: number;
      sales: number; payment: number; balance: number;
    }> = [];
    document.querySelectorAll(selector).forEach((tr) => {
      const tds = Array.from(tr.querySelectorAll("td"));
      if (tds.length < 9) return;
      const cells = tds.map((td) => (td.innerText || "").trim());
      const date = parseDt(cells[0]);
      if (!date) return;
      const itemName = cells[2] || "";
      if (!itemName || itemName === "명세소계") return;
      result.push({
        entryDate: date,
        ediCode: cells[1] || "",
        itemName,
        spec: cells[3] || "",
        quantity: parseMon(cells[4]),
        unitPrice: parseMon(cells[5]),
        sales: parseMon(cells[6]),
        payment: parseMon(cells[7]),
        balance: parseMon(cells[8]),
      });
    });
    return result;
  }, SEL.resultRows);
  return out;
}
