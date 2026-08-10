/**
 * 「⭐옵션매핑」 탭 공용 모듈 — run.ts(주문 기반)와 prefill.ts(카탈로그 기반)가 같이 쓴다.
 *
 * 원칙 (2026-08-09 확정):
 *   - 원가는 「품목사전」 한 곳에서만 관리한다.
 *   - 사장님은 옵션 줄마다 «어떤 품목인지» 드롭다운으로 고르기만 한다.
 *   - **드롭다운을 고른 줄은 그 품목의 원가를 그대로(literal) 쓴다.** 병수·조합 곱셈 없음.
 *     1+1, 종아리+무릎 교차 같은 경우의 수는 품목사전에 각각 등록해 두고 고른다.
 *   - 드롭다운이 없는 줄만 시스템이 자동 해석(병수 곱셈 포함)한다.
 *   우선순위: 「구성해석」 수동 > 드롭다운(literal) > 자동 해석
 *
 * 절대 규칙: 사장님이 입력한 값(품목 선택·유형·메모)은 어떤 경우에도 덮어쓰지 않는다.
 */

import {
  ensureTab, readRange, appendRows, writeRange, clearRange, setHeaderNotes,
  setOneOfRangeValidation, applyRowFormatRule, setFrozenRows, setColumnWidths,
  type SheetCreds,
} from "./sheets";

/** 품목사전 탭 이름 (itemdict.ts 와 동일. 순환 import 를 피하려고 여기 상수로 둔다). */
const ITEM_TAB_NAME = "품목사전";

export const OPTMAP_TAB = "⭐옵션매핑";

/**
 * ⚠️ 열 구성이 여러 번 바뀌었다. 코드는 **반드시 colOf(이름) 로만** 접근할 것.
 *    (인덱스를 숫자로 박으면 다음 변경 때 조용히 어긋난다)
 *
 * 2026-08-09 변경 이력:
 *   - A열 「스토어」 삽입
 *   - 「원가(개당)」·「물류비(건당)」 삭제 — 원가는 품목사전, 물류비는 「설정」 전역값으로 일원화
 *   - 「라벨」을 「상품명」+「옵션명」 두 열로 분리 (상품명이 모든 줄에 채워져 눈으로 묶어 보이게)
 */
export const OPTMAP_COL = {
  store: "스토어",
  originNo: "원본상품번호",
  channelNo: "채널상품번호",
  optionCode: "옵션관리번호",
  productName: "상품명",
  optionName: "옵션명",
  type: "유형(메인/추가)",
  memo: "메모",
  itemPick: "품목(선택)",
  // ── 실시간 수식 ──
  appliedCost: "적용원가",
  unitCost: "개당원가",
  alias: "별칭",
  source: "출처",
  // ── 스크립트가 아침 보고 때 채움 ──
  bottles: "병수",
  autoText: "자동해석",
  autoCost: "자동원가",
  autoSource: "자동출처",
} as const;

export const OPTMAP_HEADERS: string[] = [
  OPTMAP_COL.store,       // A
  OPTMAP_COL.originNo,    // B
  OPTMAP_COL.channelNo,   // C
  OPTMAP_COL.optionCode,  // D
  OPTMAP_COL.productName, // E
  OPTMAP_COL.optionName,  // F
  OPTMAP_COL.type,        // G
  OPTMAP_COL.memo,        // H
  OPTMAP_COL.itemPick,    // I  ★사장님(드롭다운)
  OPTMAP_COL.appliedCost, // J  수식
  OPTMAP_COL.unitCost,    // K  수식
  OPTMAP_COL.alias,       // L  수식
  OPTMAP_COL.source,      // M  수식
  OPTMAP_COL.bottles,     // N  스크립트
  OPTMAP_COL.autoText,    // O  스크립트
  OPTMAP_COL.autoCost,    // P  스크립트
  OPTMAP_COL.autoSource,  // Q  스크립트
];

export const colOf = (name: string): number => {
  const i = OPTMAP_HEADERS.indexOf(name);
  if (i < 0) throw new Error(`⭐옵션매핑 헤더 없음: ${name}`);
  return i;
};
export const colA1 = (name: string): string => String.fromCharCode(65 + colOf(name));

/**
 * 검수 열 수식 — 행마다 쓰지 않고 2행에 ARRAYFORMULA 한 번만 넣는다.
 * (행마다 넣으면 줄이 늘 때 안 따라오고 upsert 가 덮어써 날아간다)
 */
export const OPTMAP_ARRAY_FORMULAS: Record<string, string> = {
  // K 개당원가 / L 별칭 — I(품목 선택)를 품목사전에서 조회
  K2: `=ARRAYFORMULA(IF($I$2:$I="","",IFERROR(VLOOKUP($I$2:$I,${ITEM_TAB_NAME}!$A:$B,2,FALSE),"품목사전에 없음")))`,
  L2: `=ARRAYFORMULA(IF($I$2:$I="","",IFERROR(VLOOKUP($I$2:$I,${ITEM_TAB_NAME}!$A:$C,3,FALSE),"")))`,
  // J 적용원가 — 드롭다운을 고르면 **품목사전 원가 그대로**(곱셈 없음).
  //   경우의 수(1+1, 교차 조합)는 품목사전에 각각 등록해 고르는 방식이라 여기서 곱하면 안 된다.
  //   드롭다운이 없으면 스크립트가 채운 자동원가(P) 를 보여준다.
  J2: `=ARRAYFORMULA(IF($I$2:$I="",$P$2:$P,$K$2:$K))`,
  // M 출처 — 드롭다운이 있으면 즉시 「드롭다운」, 없으면 스크립트 판정값(Q)
  M2: `=ARRAYFORMULA(IF($I$2:$I="",$Q$2:$Q,"드롭다운"))`,
};

/** 헤더 1행 노트 (사장님용). OPTMAP_HEADERS 와 순서 1:1. */
export const OPTMAP_NOTES = [
  "이 상품이 어느 스토어 것인지. 자동 — 손대지 마세요.",
  "네이버 원본 상품번호. 자동 — 손대지 마세요.",
  "네이버 채널 상품번호. 자동 — 손대지 마세요.",
  "비어 있으면 = 이 상품의 대표 줄. 값이 있으면 = 그 옵션 전용 줄.\n자동 — 손대지 마세요.",
  "상품명. 모든 줄에 채워져 있어 같은 상품끼리 눈으로 묶어 볼 수 있습니다. 자동.",
  "옵션명. 대표 줄은 「(대표)」로 표시됩니다. 자동.",
  "메인 / 추가 중 하나. 비워둬도 됩니다.",
  "★사장님 메모★ 자유롭게 적으세요. 계산에 쓰이지 않습니다.",
  "★사장님 선택★ 이 옵션이 실제로 어떤 품목인지 목록에서 고르세요.\n고르면 오른쪽 「적용원가」에 품목사전 가격이 **그대로** 들어갑니다.\n1+1·교차 조합처럼 경우의 수가 있으면 품목사전에 그 조합을 등록하고 여기서 고르세요.",
  "🟢 실시간 — ★실제 적용되는 원가★\n품목을 고르면 품목사전 가격이 그대로 즉시 반영됩니다 (곱셈 없음).\n안 골랐으면 시스템이 자동으로 읽은 원가가 표시됩니다.",
  "🟢 실시간: 고른 품목의 품목사전 원가. 품목사전을 고치면 즉시 바뀝니다.",
  "🟢 실시간: 그 품목의 별칭. 매핑이 맞는지 눈으로 확인하는 용도입니다.",
  "🟢 실시간: 무엇을 근거로 계산했는지.\n드롭다운 = 사장님이 고른 값 / 그 외는 시스템 자동 판정",
  "🕗 아침 보고 때 갱신: 옵션 이름에서 읽은 병(개) 수 (자동 해석용).",
  "🕗 아침 보고 때 갱신: 시스템이 스스로 읽은 구성. 예: 피쿠알×2+블렌딩×1",
  "🕗 아침 보고 때 갱신: 자동 해석 기준 원가 (참고용).",
  "🕗 아침 보고 때 갱신: 드롭다운이 없을 때의 자동 판정 출처 (참고용).",
];

/** 「⭐옵션매핑」에서 제외하는 스토어 (원가가 사입관리 실매입가로 들어오는 곳). */
export const OPTMAP_EXCLUDED_STORES = new Set(["여기명품"]);

/** 대표 줄 옵션명 표시값. */
export const PRODUCT_ROW_MARK = "(대표)";

/** 탭 보장 + 헤더/노트/드롭다운/수식/시각 정리. 부가 설정 실패는 삼킨다. */
export async function ensureOptionMapTab(c: SheetCreds): Promise<void> {
  await ensureTab(c, OPTMAP_TAB, OPTMAP_HEADERS);
  try {
    await setHeaderNotes(c, OPTMAP_TAB, OPTMAP_NOTES);
  } catch (err) {
    console.warn(`[${OPTMAP_TAB}] 헤더 노트 실패(무시): ${err instanceof Error ? err.message : err}`);
  }
  try {
    await setOneOfRangeValidation(c, OPTMAP_TAB, colOf(OPTMAP_COL.itemPick), ITEM_TAB_NAME, "A");
  } catch (err) {
    console.warn(`[${OPTMAP_TAB}] 드롭다운 설정 실패(무시): ${err instanceof Error ? err.message : err}`);
  }
  try {
    // 수식을 다시 심기 전에 수식 영역을 비운다 (열 구성이 바뀌면 옛 위치 배열수식이 겹쳐 #REF).
    await clearRange(c, `${OPTMAP_TAB}!${colA1(OPTMAP_COL.appliedCost)}2:${colA1(OPTMAP_COL.source)}20000`);
    for (const [cell, formula] of Object.entries(OPTMAP_ARRAY_FORMULAS)) {
      await writeRange(c, `${OPTMAP_TAB}!${cell}`, [[formula]]);
    }
  } catch (err) {
    console.warn(`[${OPTMAP_TAB}] 검수 수식 설정 실패(무시): ${err instanceof Error ? err.message : err}`);
  }
  try {
    await applyOptMapVisuals(c);
  } catch (err) {
    console.warn(`[${OPTMAP_TAB}] 시각 정리 실패(무시): ${err instanceof Error ? err.message : err}`);
  }
}

/** 한눈에 들어오게 — 헤더 고정, 대표 줄 강조, 열 너비. */
export async function applyOptMapVisuals(c: SheetCreds): Promise<void> {
  await setFrozenRows(c, OPTMAP_TAB, 1);
  await setColumnWidths(c, OPTMAP_TAB, [
    { name: OPTMAP_COL.store, px: 90 },
    { name: OPTMAP_COL.originNo, px: 105 },
    { name: OPTMAP_COL.channelNo, px: 105 },
    { name: OPTMAP_COL.optionCode, px: 110 },
    { name: OPTMAP_COL.productName, px: 260 },
    { name: OPTMAP_COL.optionName, px: 300 },
    { name: OPTMAP_COL.type, px: 70 },
    { name: OPTMAP_COL.memo, px: 110 },
    { name: OPTMAP_COL.itemPick, px: 190 },
    { name: OPTMAP_COL.appliedCost, px: 90 },
    { name: OPTMAP_COL.unitCost, px: 85 },
    { name: OPTMAP_COL.alias, px: 140 },
    { name: OPTMAP_COL.source, px: 85 },
    { name: OPTMAP_COL.bottles, px: 55 },
    { name: OPTMAP_COL.autoText, px: 200 },
    { name: OPTMAP_COL.autoCost, px: 85 },
    { name: OPTMAP_COL.autoSource, px: 85 },
  ].map((x) => ({ index: colOf(x.name), px: x.px })));

  const codeCol = colA1(OPTMAP_COL.optionCode);
  // 대표 줄(옵션관리번호가 빈 줄) = 상품 단위 구분선. 옅은 회색 + 굵게.
  await applyRowFormatRule(
    c, OPTMAP_TAB,
    `=$${codeCol}2=""`,
    OPTMAP_HEADERS.length,
    { backgroundColor: { red: 0.93, green: 0.94, blue: 0.96 }, textFormat: { bold: true } },
  );
  // 손봐야 할 줄 = 노란색
  await applyRowFormatRule(
    c, OPTMAP_TAB,
    `=$${colA1(OPTMAP_COL.source)}2="설정 필요"`,
    OPTMAP_HEADERS.length,
    { backgroundColor: { red: 1, green: 0.95, blue: 0.7 } },
  );
}

export interface AuditCtx {
  store: string;
  channelProductNo: string;
  optionManageCode: string;
  productName: string;
  optionName: string;
  pickedItem: string;
}

/**
 * 스크립트가 채우는 검수 4칸(병수·자동해석·자동원가·자동출처) 갱신.
 * 수식 칸은 절대 건드리지 않는다 (쓰면 배열 수식이 날아간다).
 */
export async function refreshOptMapAudit(
  c: SheetCreds,
  resolve: (ctx: AuditCtx) => {
    bottles: number; autoText: string; autoCost: number | ""; source: string;
  },
): Promise<{ rows: number; flagged: number }> {
  const rows = await readRange(c, `${OPTMAP_TAB}!A2:${colA1(OPTMAP_COL.itemPick)}20000`);
  if (rows.length === 0) return { rows: 0, flagged: 0 };

  const iStore = colOf(OPTMAP_COL.store);
  const iCh = colOf(OPTMAP_COL.channelNo);
  const iCode = colOf(OPTMAP_COL.optionCode);
  const iProd = colOf(OPTMAP_COL.productName);
  const iOpt = colOf(OPTMAP_COL.optionName);
  const iPick = colOf(OPTMAP_COL.itemPick);

  const out: (string | number)[][] = [];
  let flagged = 0;
  for (const r of rows) {
    const picked = String(r[iPick] ?? "").trim();
    const { bottles, autoText, autoCost, source } = resolve({
      store: String(r[iStore] ?? "").trim(),
      channelProductNo: String(r[iCh] ?? "").trim(),
      optionManageCode: String(r[iCode] ?? "").trim(),
      productName: String(r[iProd] ?? "").trim(),
      optionName: String(r[iOpt] ?? "").trim(),
      pickedItem: picked,
    });
    out.push([bottles, autoText, autoCost, source]);
    // 드롭다운을 고른 줄은 사장님이 이미 정리한 줄 — 노란 표시 대상 아님
    if (!picked && source === "설정 필요") flagged += 1;
  }
  await writeRange(
    c,
    `${OPTMAP_TAB}!${colA1(OPTMAP_COL.bottles)}2:${colA1(OPTMAP_COL.autoSource)}${rows.length + 1}`,
    out,
  );
  return { rows: rows.length, flagged };
}

/** 자동 추가 후보 한 줄. */
export interface OptMapEntry {
  store: string;
  originProductNo: string;
  channelProductNo: string;
  optionManageCode: string; // "" = 상품 대표 줄
  productName: string;
  optionName: string;
}

interface ExistingState {
  keys: Set<string>;
  channels: Set<string>;
}

const keyOf = (chNo: string, optCode: string) => (optCode ? `${chNo}|${optCode}` : chNo);

async function readExisting(c: SheetCreds): Promise<ExistingState> {
  const rows = await readRange(c, `${OPTMAP_TAB}!A2:${colA1(OPTMAP_COL.itemPick)}20000`);
  const iCh = colOf(OPTMAP_COL.channelNo);
  const iCode = colOf(OPTMAP_COL.optionCode);
  const keys = new Set<string>();
  const channels = new Set<string>();
  for (const r of rows) {
    const chNo = String(r[iCh] ?? "").trim();
    if (!chNo) continue;
    keys.add(keyOf(chNo, String(r[iCode] ?? "").trim()));
    channels.add(chNo);
  }
  return { keys, channels };
}

/**
 * 없는 줄만 append. 기존 줄은 읽기만 하고 절대 건드리지 않는다.
 * 새 상품은 「대표 줄 → 옵션 줄들」 순서로 이어 붙인다(기존 줄 순서는 재정렬하지 않음).
 */
export async function mergeOptionMapEntries(
  c: SheetCreds,
  entries: OptMapEntry[],
): Promise<{ addedRows: number; newProducts: { channelProductNo: string; label: string }[] }> {
  await ensureOptionMapTab(c);
  const existing = await readExisting(c);

  const byChannel = new Map<string, OptMapEntry[]>();
  for (const e of entries) {
    const chNo = e.channelProductNo.trim();
    if (!chNo) continue;
    if (OPTMAP_EXCLUDED_STORES.has(e.store)) continue;
    const list = byChannel.get(chNo) ?? [];
    list.push(e);
    byChannel.set(chNo, list);
  }

  const toAppend: (string | number)[][] = [];
  const newProducts: { channelProductNo: string; label: string }[] = [];

  for (const [chNo, list] of byChannel) {
    const isNewProduct = !existing.channels.has(chNo);
    const hasProductLevel = list.some((e) => !e.optionManageCode);
    const ordered: OptMapEntry[] = [];
    if (!hasProductLevel) {
      const seed = list[0];
      ordered.push({ ...seed, optionManageCode: "", optionName: "" });
    }
    ordered.push(...list.filter((e) => !e.optionManageCode), ...list.filter((e) => e.optionManageCode));

    let addedForThis = 0;
    for (const e of ordered) {
      const k = keyOf(chNo, e.optionManageCode);
      if (existing.keys.has(k)) continue;
      existing.keys.add(k);
      // 「품목(선택)」까지만 쓴다. 그 뒤는 비워둬야 ARRAYFORMULA 가 그 줄까지 자동으로 채운다.
      const row = new Array(colOf(OPTMAP_COL.itemPick) + 1).fill("");
      row[colOf(OPTMAP_COL.store)] = e.store;
      row[colOf(OPTMAP_COL.originNo)] = e.originProductNo;
      row[colOf(OPTMAP_COL.channelNo)] = chNo;
      row[colOf(OPTMAP_COL.optionCode)] = e.optionManageCode;
      row[colOf(OPTMAP_COL.productName)] = e.productName.slice(0, 60);
      row[colOf(OPTMAP_COL.optionName)] = e.optionManageCode ? e.optionName : PRODUCT_ROW_MARK;
      toAppend.push(row);
      addedForThis += 1;
    }
    if (isNewProduct && addedForThis > 0) {
      newProducts.push({ channelProductNo: chNo, label: list[0].productName });
    }
  }

  if (toAppend.length > 0) {
    await appendRows(c, `${OPTMAP_TAB}!A1`, toAppend);
  }
  return { addedRows: toAppend.length, newProducts };
}
