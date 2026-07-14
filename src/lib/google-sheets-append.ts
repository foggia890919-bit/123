import { findOrCreateSpreadsheet, sheetsApi } from "./google-sheets";

const SALES_SHEET_TAB = "실적";
const SALES_HEADERS = ["기록일시", "병원명", "실적일", "금액", "영업사원", "출처"] as const;

export interface SalesAppendRow {
  hospitalName: string;
  salesDate: string;     // "YYYY-MM-DD" 또는 ""
  totalAmount: number;
  salesRep: string;
  source?: "kakao" | "manual" | "api";
}

function spreadsheetName(): string {
  return process.env.GOOGLE_SHEETS_SALES_SPREADSHEET_NAME?.trim() || "병원 실적 데이터";
}

function isAlreadyExistsError(err: unknown): boolean {
  const s = String(err);
  return s.includes("ALREADY_EXISTS") || s.includes("already exists") || s.includes("이미 존재");
}

async function ensureTabExists(spreadsheetId: string): Promise<void> {
  const meta = await sheetsApi(`/${spreadsheetId}?fields=sheets.properties`) as {
    sheets: { properties: { sheetId: number; title: string } }[];
  };
  const hasTab = meta.sheets?.some((s) => s.properties.title === SALES_SHEET_TAB);
  if (hasTab) return;

  // 탭 생성. 동시 요청으로 ALREADY_EXISTS 떨어지면 다른 요청이 만들었다는 뜻 — 무시.
  try {
    await sheetsApi(`/${spreadsheetId}:batchUpdate`, "POST", {
      requests: [{ addSheet: { properties: { title: SALES_SHEET_TAB } } }],
    });
  } catch (e) {
    if (!isAlreadyExistsError(e)) throw e;
  }

  // 헤더 행 기록 (idempotent: 빈 시트에 항상 안전하게 A1 부터 덮어쓰기)
  const headerRange = `${encodeURIComponent(SALES_SHEET_TAB)}!A1`;
  await sheetsApi(
    `/${spreadsheetId}/values/${headerRange}?valueInputOption=USER_ENTERED`,
    "PUT",
    { values: [SALES_HEADERS as unknown as string[]] },
  );
}

export async function appendSalesRow(
  row: SalesAppendRow,
): Promise<{ spreadsheetUrl: string; appendedRange: string }> {
  const id = await findOrCreateSpreadsheet(spreadsheetName());
  await ensureTabExists(id);

  const values = [[
    new Date().toISOString(),
    row.hospitalName,
    row.salesDate,
    row.totalAmount,
    row.salesRep || "",
    row.source ?? "manual",
  ]];

  // 한글 탭명 + ! + 범위 전체를 URL 인코딩. raw 삽입 시 Sheets 가 400 으로 거절함.
  const range = encodeURIComponent(`${SALES_SHEET_TAB}!A:F`);
  const res = await sheetsApi(
    `/${id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    "POST",
    { values },
  ) as { updates?: { updatedRange?: string } };

  return {
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}`,
    appendedRange: res.updates?.updatedRange ?? "",
  };
}
