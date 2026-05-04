// ePharms (yk.ep45.co.kr) 매출원장 스크래퍼
//
// 화면 확인 (사장님 캡쳐 기준):
//   원장집계: https://yk.ep45.co.kr/account/account_list
//   컬럼: 명세일자 | 항목 | 매출 | 수금 | 잔액
//   조회기간: 시작일 ~ 종료일 + "검색" 버튼
//   상단: 메뉴 좌측 사이드바 → 장부 > 원장집계
//
// 셀렉터는 실제 사이트에서 1회 사람이 들어가서 확정해야 함 (현재는 추정값).
// 확정 후 SEL 객체만 손보면 됨.

import type { Page } from "playwright";

export interface EpharmsCreds {
  loginId: string;
  loginPw: string;
}

export interface LedgerRow {
  entryDate: string;   // YYYY-MM-DD
  itemName: string;
  sales: number;
  payment: number;
  balance: number;
}

const BASE = "https://yk.ep45.co.kr";

const SEL = {
  // ----- 로그인 (확정: 2026-05 사장님 outerHTML 검증) -----
  idInput:    '#userId',
  pwInput:    '#userPwd',
  loginBtn:   '#loginBtn',
  // ----- 원장집계 (확정) -----
  // 페이지에 1개월/3개월/6개월/1년 빠른 선택 버튼이 있어서 이걸 쓰는 게 가장 안정적.
  // (datepicker 직접 조작은 페이지의 dateFormat·내부 상태 동기화 문제로 깨지기 쉬움)
  periodYearBtn: 'button.PeriodBtn[data-periodtyp="Y"][data-periodnum="1"]',
  // 백업: 직접 날짜 인풋 조작 (위 버튼이 없을 때만)
  dateFromInput: '#search_pd_start',
  dateToInput:   '#search_pd_end',
  searchBtn:     '#btnSrch',
  // 결과 테이블: 명세일자 헤더가 있는 테이블의 tbody tr.
  resultRows:    'table:has(th:has-text("명세일자")) tbody tr',
};

const LOGIN_URL  = `${BASE}/`;                       // 메인이 로그인 폼
const LEDGER_URL = `${BASE}/account/account_list`;

function parseMoney(s: string): number {
  // "458,120" → 458120, "" → 0, "-1,000" → -1000
  const cleaned = (s || "").replace(/[^\d-]/g, "");
  if (!cleaned || cleaned === "-") return 0;
  return Number(cleaned);
}

function parseDate(s: string): string | null {
  // "2025-05-02" 형태로 그대로 오면 통과. 다른 포맷이면 ISO로 정규화.
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

  // 이미 로그인 상태면 PW 인풋 안 보임 → skip
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

/** 지정 기간의 원장집계를 긁는다. (default: 최근 1년) */
export async function fetchLedger(page: Page): Promise<LedgerRow[]> {
  await page.goto(LEDGER_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(800);

  // 페이지의 "1년" 빠른선택 버튼 클릭 — datepicker 내부 상태까지 정확히 세팅됨.
  // (readonly + jQuery UI datepicker 직접 조작은 dateFormat·내부 상태 동기화 문제로 깨지기 쉬움)
  const yearBtn = page.locator(SEL.periodYearBtn).first();
  if (await yearBtn.count() > 0) {
    await yearBtn.click();
    console.log('[ePharms] clicked "1년" period button');
    await page.waitForTimeout(500);
  } else {
    console.warn('[ePharms] "1년" period button not found — falling back to default page state');
  }

  // 검색 버튼 클릭 (페이지가 자동으로 검색 안 한 경우 대비)
  const sBtn = page.locator(SEL.searchBtn).first();
  if (await sBtn.isVisible().catch(() => false)) {
    await sBtn.click();
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  }
  await page.waitForTimeout(1500); // 결과 테이블 렌더링 대기

  // 결과 테이블 파싱
  const rows = await page.locator(SEL.resultRows).all();
  const out: LedgerRow[] = [];
  for (const row of rows) {
    const cells = await row.locator("td").allInnerTexts();
    if (cells.length < 5) continue;          // 합계행 / 헤더 스킵
    const date = parseDate(cells[0]);
    if (!date) continue;                     // "전일잔액" / "월계" 같은 행은 날짜 없음 → 스킵
    out.push({
      entryDate: date,
      itemName: (cells[1] || "").trim(),
      sales:   parseMoney(cells[2]),
      payment: parseMoney(cells[3]),
      balance: parseMoney(cells[4]),
    });
  }
  return out;
}
