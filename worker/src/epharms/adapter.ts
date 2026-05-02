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
  // ----- 로그인 (실제 사이트에서 확정 필요) -----
  // 흔한 패턴 4종을 OR로 묶어둠 — 그중 하나는 잡힐 가능성이 높음.
  idInput:
    'input[name="userId"], input[name="user_id"], input[name="id"], input[name="loginId"], input[type="text"]:not([readonly])',
  pwInput:
    'input[name="userPw"], input[name="user_pw"], input[name="pw"], input[name="password"], input[type="password"]',
  loginBtn:
    'button:has-text("로그인"), input[type="submit"][value*="로그인"], a:has-text("로그인"), button[type="submit"]',
  // ----- 원장집계 -----
  // URL 직접 이동: /account/account_list
  // 검색 form (날짜 인풋 2개 + 검색 버튼)
  dateFromInput: 'input[name="fromDate"], input[name="from_dt"], input[name="startDate"], input[type="date"]:nth-of-type(1)',
  dateToInput:   'input[name="toDate"],   input[name="to_dt"],   input[name="endDate"],   input[type="date"]:nth-of-type(2)',
  searchBtn:     'button:has-text("검색"), input[type="button"][value*="검색"], button:has-text("조회")',
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
export async function fetchLedger(
  page: Page,
  opts: { from?: string; to?: string } = {}
): Promise<LedgerRow[]> {
  const today = new Date();
  const oneYearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const from = opts.from ?? fmt(oneYearAgo);
  const to   = opts.to   ?? fmt(today);

  await page.goto(LEDGER_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(800);

  // 날짜 입력 — 사이트가 readonly일 수도 있으므로 evaluate로 직접 set 도 시도
  const setDate = async (selector: string, value: string) => {
    const el = page.locator(selector).first();
    if (!(await el.count())) return;
    await el.fill(value).catch(async () => {
      await el.evaluate((node, v) => {
        (node as HTMLInputElement).value = v;
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
    });
  };
  await setDate(SEL.dateFromInput, from);
  await setDate(SEL.dateToInput, to);

  const sBtn = page.locator(SEL.searchBtn).first();
  if (await sBtn.isVisible().catch(() => false)) {
    await sBtn.click();
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  }
  await page.waitForTimeout(800);

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
