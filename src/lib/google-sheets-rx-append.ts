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

// batchId 컬럼 인덱스 — 검수 페이지 수정 시 옛 batchId 행 찾아서 삭제용
const SUMMARY_BATCH_ID_COL = SUMMARY_HEADERS.indexOf("batchId");   // 10
const DRUGS_BATCH_ID_COL = DRUGS_HEADERS.indexOf("batchId");      // 1

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

// 특정 batchId 의 모든 행을 시트에서 삭제. 검수 페이지에서 수정 시 옛 데이터 제거용.
// 두 탭 (요약/약품) 모두 처리. 실패해도 throw 안 하고 결과만 반환.
async function deleteRowsByBatchId(
  spreadsheetId: string,
  tab: string,
  batchIdColumnIndex: number,
  batchId: string,
): Promise<{ deleted: number }> {
  // 1) 시트 전체 조회
  const range = encodeURIComponent(`${tab}!A:Z`);
  const data = await sheetsApi(`/${spreadsheetId}/values/${range}`) as { values?: string[][] };
  const rows = data.values ?? [];
  if (rows.length === 0) return { deleted: 0 };

  // 2) 매칭 행 인덱스 (헤더는 row 0, 건너뜀)
  const targetIndices: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.[batchIdColumnIndex] === batchId) targetIndices.push(i);
  }
  if (targetIndices.length === 0) return { deleted: 0 };

  // 3) sheetId 조회
  const meta = await sheetsApi(`/${spreadsheetId}?fields=sheets.properties`) as {
    sheets: { properties: { sheetId: number; title: string } }[];
  };
  const sheet = meta.sheets.find((s) => s.properties.title === tab);
  if (!sheet) return { deleted: 0 };
  const sheetId = sheet.properties.sheetId;

  // 4) 행 삭제 — 역순 (인덱스 안 밀리도록)
  const requests = [...targetIndices]
    .sort((a, b) => b - a)
    .map((idx) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: idx,
          endIndex: idx + 1,
        },
      },
    }));
  await sheetsApi(`/${spreadsheetId}:batchUpdate`, "POST", { requests });
  return { deleted: targetIndices.length };
}

// 검수 페이지 수정 → 옛 batchId 행 시트에서 삭제 + 새 batchId 로 재append.
// 결과: 시트에서 옛 데이터 사라지고 최신만 보임.
export async function replaceRxStats(
  oldBatchId: string,
  newPayload: RxExtractResult,
  source: RxSource,
): Promise<AppendRxResult & { deletedSummary: number; deletedDrugs: number }> {
  const id = await findOrCreateSpreadsheet(spreadsheetName());

  // 1) 옛 batchId 의 행들 두 탭에서 삭제 (실패해도 진행 — 새 데이터는 들어가야 함)
  let deletedSummary = 0;
  let deletedDrugs = 0;
  try {
    const r1 = await deleteRowsByBatchId(id, SUMMARY_TAB, SUMMARY_BATCH_ID_COL, oldBatchId);
    deletedSummary = r1.deleted;
  } catch (e) {
    console.error("[replaceRxStats summary delete]", oldBatchId, String(e).slice(0, 200));
  }
  try {
    const r2 = await deleteRowsByBatchId(id, DRUGS_TAB, DRUGS_BATCH_ID_COL, oldBatchId);
    deletedDrugs = r2.deleted;
  } catch (e) {
    console.error("[replaceRxStats drugs delete]", oldBatchId, String(e).slice(0, 200));
  }

  // 2) 새 batchId 로 append
  const appended = await appendRxStats(newPayload, source);

  return {
    ...appended,
    deletedSummary,
    deletedDrugs,
  };
}
