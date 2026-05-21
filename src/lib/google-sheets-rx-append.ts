import { randomUUID } from "node:crypto";
import { findOrCreateSpreadsheet, sheetsApi } from "./google-sheets";
import type { RxExtractResult } from "./gemini-rx-stats-extract";

export type RxSource = "manual" | "api" | "kakao";

const SUMMARY_TAB = "요약";
const DRUGS_TAB = "약품";
const SUMMARY_HEADERS = [
  "기록일시", "제약사", "기간(YYYY-MM)", "기간원본", "병원",
  "약품수", "처방횟수", "총사용량", "총금액", "출처", "batchId",
] as const;
const DRUGS_HEADERS = [
  "기록일시", "batchId", "제약사", "기간(YYYY-MM)",
  "약품명", "보험코드", "사용량", "처방횟수", "단가", "총금액", "카테고리", "효능",
] as const;

export interface AppendRxResult {
  spreadsheetUrl: string;
  summaryRange: string;
  drugsRange: string;
  batchId: string;
}

function spreadsheetName(): string {
  return process.env.GOOGLE_SHEETS_RX_STATS_SPREADSHEET_NAME?.trim() || "처방통계 데이터";
}

function isAlreadyExistsError(err: unknown): boolean {
  const s = String(err);
  return s.includes("ALREADY_EXISTS") || s.includes("already exists") || s.includes("이미 존재");
}

async function ensureTab(
  spreadsheetId: string,
  tab: string,
  headers: readonly string[],
): Promise<void> {
  const meta = await sheetsApi(`/${spreadsheetId}?fields=sheets.properties`) as {
    sheets: { properties: { sheetId: number; title: string } }[];
  };
  const hasTab = meta.sheets?.some((s) => s.properties.title === tab);

  if (!hasTab) {
    try {
      await sheetsApi(`/${spreadsheetId}:batchUpdate`, "POST", {
        requests: [{ addSheet: { properties: { title: tab } } }],
      });
    } catch (e) {
      if (!isAlreadyExistsError(e)) throw e;
    }
  }

  // 헤더 idempotent 기록 — 빈 시트든 기존 시트든 A1 부터 덮어쓰기.
  const headerRange = encodeURIComponent(`${tab}!A1`);
  await sheetsApi(
    `/${spreadsheetId}/values/${headerRange}?valueInputOption=USER_ENTERED`,
    "PUT",
    { values: [headers as unknown as string[]] },
  );
}

export async function appendRxStats(
  payload: RxExtractResult,
  source: RxSource,
): Promise<AppendRxResult> {
  const id = await findOrCreateSpreadsheet(spreadsheetName());

  // 두 탭은 서로 다른 이름이라 충돌 없음 — 병렬 ensure.
  await Promise.all([
    ensureTab(id, SUMMARY_TAB, SUMMARY_HEADERS),
    ensureTab(id, DRUGS_TAB, DRUGS_HEADERS),
  ]);

  const batchId = randomUUID();
  const ts = new Date().toISOString();

  const summaryRow: (string | number)[][] = [[
    ts,
    payload.pharma,
    payload.period,
    payload.periodRaw,
    payload.hospital,
    payload.summary.drugCount,
    payload.summary.totalPrescriptions,
    payload.summary.totalQuantity,
    payload.summary.totalAmountWon,
    source,
    batchId,
  ]];

  const drugRows: (string | number)[][] = payload.drugs.map((d) => [
    ts,
    batchId,
    payload.pharma,
    payload.period,
    d.name,
    d.code,
    d.quantity,
    d.prescriptions,
    d.unitPrice,
    d.totalPrice,
    d.category,
    d.efficacy,
  ]);

  const sumRange = encodeURIComponent(`${SUMMARY_TAB}!A:K`);
  const drugRange = encodeURIComponent(`${DRUGS_TAB}!A:L`);

  const sumRes = await sheetsApi(
    `/${id}/values/${sumRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    "POST",
    { values: summaryRow },
  ) as { updates?: { updatedRange?: string } };

  let drugsRange = "";
  if (drugRows.length > 0) {
    const drugRes = await sheetsApi(
      `/${id}/values/${drugRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      "POST",
      { values: drugRows },
    ) as { updates?: { updatedRange?: string } };
    drugsRange = drugRes.updates?.updatedRange ?? "";
  }

  return {
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}`,
    summaryRange: sumRes.updates?.updatedRange ?? "",
    drugsRange,
    batchId,
  };
}
