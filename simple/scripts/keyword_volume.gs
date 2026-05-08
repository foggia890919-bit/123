/**
 * 「키워드 검색량 조회」 Google Apps Script
 *
 * 사용법:
 *   1. 매출보고 시트 → 메뉴 「확장 프로그램」 → 「Apps Script」
 *   2. 이 파일 전체 내용 붙여넣기
 *   3. 좌측 「프로젝트 설정」(⚙️) → 「스크립트 속성」 → 다음 3개 추가:
 *        NAVER_AD_API_KEY     = (검색광고 API 라이선스)
 *        NAVER_AD_SECRET      = (검색광고 비밀키)
 *        NAVER_AD_CUSTOMER_ID = (Customer ID 숫자)
 *   4. 저장 (Ctrl+S)
 *   5. 시트로 돌아가서 새로고침 (F5) → 메뉴에 「🔍 키워드 도구」 나타남
 *   6. 「🔍 키워드 도구 → 검색량 조회」 클릭 → 권한 승인
 *
 * 시트 구조 (자동 생성):
 *   탭 「키워드검색량」
 *     A1 : ▶ 실행 버튼 (셀 자체)
 *     A3 : 키워드 (헤더)
 *     B3 : PC 월검색
 *     C3 : 모바일 월검색
 *     D3 : 합계
 *     E3 : 경쟁도
 *     F3 : 수집일
 *     A4~ : 사장님이 키워드 입력
 *     B4~ : 자동 채워짐
 */

const TAB_NAME = "키워드검색량";

/** 시트 열릴 때 메뉴 추가 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🔍 키워드 도구")
    .addItem("검색량 조회 (선택 키워드)", "fetchKeywordVolumes")
    .addItem("탭 초기화 (없으면 만들기)", "ensureKeywordTab")
    .addToUi();
}

/** 「키워드검색량」 탭이 없으면 생성 */
function ensureKeywordTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TAB_NAME);
  }
  // 헤더 + 사용 안내
  sheet.getRange("A1").setValue("▶ 메뉴 「🔍 키워드 도구 → 검색량 조회」 클릭하면 자동 채워짐").setFontWeight("bold").setBackground("#fff2cc");
  sheet.getRange("A1:F1").merge();
  sheet.getRange(3, 1, 1, 6).setValues([["키워드", "PC 월검색", "모바일 월검색", "합계", "경쟁도", "수집일"]]).setFontWeight("bold").setBackground("#d9ead3");
  sheet.setColumnWidths(1, 1, 200);
  sheet.setColumnWidths(2, 4, 120);
  sheet.setColumnWidths(6, 1, 100);
  SpreadsheetApp.getActiveSpreadsheet().toast(`「${TAB_NAME}」 탭 준비됨. A4 부터 키워드 입력 후 메뉴 실행.`, "✅", 5);
}

/** 메인: 키워드 → 검색량 채우기 */
function fetchKeywordVolumes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) {
    SpreadsheetApp.getUi().alert(`「${TAB_NAME}」 탭이 없습니다. 메뉴 「🔍 키워드 도구 → 탭 초기화」 먼저 실행.`);
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 4) {
    SpreadsheetApp.getUi().alert(`A4 부터 키워드를 입력하세요.`);
    return;
  }

  // A4부터 키워드 읽기
  const range = sheet.getRange(4, 1, lastRow - 3, 1);
  const rawValues = range.getValues();
  const keywords = [];
  const rowIndices = [];
  for (let i = 0; i < rawValues.length; i++) {
    const k = String(rawValues[i][0] || "").trim();
    if (k) {
      keywords.push(k);
      rowIndices.push(i + 4); // 시트 행 번호 (1-based)
    }
  }

  if (keywords.length === 0) {
    SpreadsheetApp.getUi().alert(`A4 부터 키워드를 입력하세요.`);
    return;
  }

  ss.toast(`${keywords.length}개 키워드 조회 중…`, "🔍");
  const today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");

  // 검색광고 API 는 한 번에 최대 5개 hint 까지 권장
  const BATCH = 5;
  const resultByKw = {};
  let errorCount = 0;

  for (let i = 0; i < keywords.length; i += BATCH) {
    const batch = keywords.slice(i, i + BATCH);
    try {
      const list = callKeywordTool(batch);
      // 본 키워드만 매핑 (연관 키워드는 무시)
      for (const k of batch) {
        const found = list.find((row) => row.relKeyword === k || row.relKeyword === k.replace(/\s+/g, ""));
        if (found) {
          const pc = num_(found.monthlyPcQcCnt);
          const mb = num_(found.monthlyMobileQcCnt);
          resultByKw[k] = {
            pc,
            mb,
            sum: pc + mb,
            comp: found.compIdx || "",
          };
        } else {
          resultByKw[k] = { pc: 0, mb: 0, sum: 0, comp: "데이터없음" };
        }
      }
    } catch (err) {
      console.error("API error:", err);
      errorCount++;
      for (const k of batch) {
        resultByKw[k] = { pc: 0, mb: 0, sum: 0, comp: `오류: ${String(err).slice(0, 30)}` };
      }
    }
    Utilities.sleep(300);
  }

  // 결과 쓰기
  const out = keywords.map((k) => {
    const r = resultByKw[k];
    return [r.pc, r.mb, r.sum, r.comp, today];
  });
  // B~F 한 번에 (행은 연속이 아닐 수 있어서 한 셀씩)
  for (let i = 0; i < keywords.length; i++) {
    sheet.getRange(rowIndices[i], 2, 1, 5).setValues([out[i]]);
  }

  // 합계 기준 정렬은 사장님이 원하면 시트에서 직접 (자동정렬은 안 함)
  ss.toast(
    `${keywords.length}개 완료${errorCount > 0 ? ` (오류 ${errorCount}건)` : ""}`,
    "✅",
    8,
  );
}

/** 검색광고 API 「키워드 도구」 호출 (HMAC-SHA256 서명) */
function callKeywordTool(hintKeywords) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty("NAVER_AD_API_KEY");
  const secret = props.getProperty("NAVER_AD_SECRET");
  const customerId = props.getProperty("NAVER_AD_CUSTOMER_ID");

  if (!apiKey || !secret || !customerId) {
    throw new Error(
      "NAVER_AD_API_KEY/SECRET/CUSTOMER_ID 미설정. " +
      "Apps Script → 프로젝트 설정(⚙️) → 스크립트 속성 → 3개 추가",
    );
  }

  const path = "/keywordstool";
  const ts = String(Date.now());
  const sigBytes = Utilities.computeHmacSha256Signature(`${ts}.GET.${path}`, secret);
  const signature = Utilities.base64Encode(sigBytes);

  const url =
    `https://api.naver.com${path}` +
    `?hintKeywords=${encodeURIComponent(hintKeywords.join(","))}` +
    `&showDetail=1`;

  const res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      "X-Timestamp": ts,
      "X-API-KEY": apiKey,
      "X-Customer": customerId,
      "X-Signature": signature,
    },
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error(`API ${code}: ${res.getContentText().slice(0, 200)}`);
  }
  const data = JSON.parse(res.getContentText());
  return data.keywordList || [];
}

function num_(v) {
  if (v === "< 10" || v === undefined || v === null) return 0;
  return Number(v) || 0;
}
