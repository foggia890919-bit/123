/**
 * 「⭐옵션매핑」 탭 공용 모듈 — run.ts(주문 기반)와 prefill.ts(카탈로그 기반)가 같이 쓴다.
 *
 * 시트 규칙 (기존 관례 유지):
 *   - 「옵션관리번호」가 빈 줄 = 그 상품의 **대표 줄**. 여기 원가를 넣으면 그 상품 전 옵션에 적용된다.
 *   - 옵션관리번호가 있는 줄 = 그 옵션 전용. 대표 줄 값을 덮어쓴다(수동 우선).
 *
 * 절대 규칙: **사장님이 입력한 값은 어떤 경우에도 덮어쓰지 않는다.**
 * 자동 채움은 (a) 아예 없는 줄을 새로 추가하거나, (b) 비어 있는 칸만 메꾼다.
 */

import {
  ensureTab, readRange, appendRows, writeRange, setHeaderNotes, setOneOfRangeValidation,
  type SheetCreds,
} from "./sheets";

/** 품목사전 탭 이름 (itemdict.ts 와 동일. 순환 import 를 피하려고 여기 상수로 둔다). */
const ITEM_TAB_NAME = "품목사전";

export const OPTMAP_TAB = "⭐옵션매핑";

/**
 * ⚠️⚠️ 2026-08-09 열 구조 변경 — A열에 「스토어」 삽입. 기존 열이 한 칸씩 밀렸다.
 *      옛 열 순서로 읽는 코드(다른 머신의 미push 본 포함)는 **즉시 pull** 해야 한다.
 *      그렇지 않으면 원본상품번호를 스토어로 읽는 식으로 조용히 어긋난다.
 *
 * 재발 방지: 아래 이름 상수 + colOf() 로 **헤더 이름 기반**으로 읽는다.
 *           앞으로 열을 끼워도 코드는 그대로 동작한다.
 */
export const OPTMAP_COL = {
  store: "스토어",
  originNo: "원본상품번호",
  channelNo: "채널상품번호",
  optionCode: "옵션관리번호",
  label: "라벨",
  cost: "원가(개당)",
  logistics: "물류비(건당)",
  type: "유형(메인/추가)",
  memo: "메모",
  itemPick: "품목(선택)",
  bottles: "병수",
  unitCost: "개당원가",
  alias: "별칭",
  optionCost: "옵션원가",
  autoText: "자동해석",
  autoCost: "해석원가",
  source: "출처",
} as const;

export const OPTMAP_HEADERS: string[] = [
  OPTMAP_COL.store,       // A — 신규
  OPTMAP_COL.originNo,    // B
  OPTMAP_COL.channelNo,   // C
  OPTMAP_COL.optionCode,  // D
  OPTMAP_COL.label,       // E
  OPTMAP_COL.cost,        // F  ★사장님
  OPTMAP_COL.logistics,   // G  ★사장님
  OPTMAP_COL.type,        // H
  OPTMAP_COL.memo,        // I  ★사장님
  OPTMAP_COL.itemPick,    // J  ★사장님(드롭다운)
  OPTMAP_COL.bottles,     // K  스크립트
  OPTMAP_COL.unitCost,    // L  수식
  OPTMAP_COL.alias,       // M  수식
  OPTMAP_COL.optionCost,  // N  수식
  OPTMAP_COL.autoText,    // O  스크립트
  OPTMAP_COL.autoCost,    // P  스크립트
  OPTMAP_COL.source,      // Q  스크립트
];

/** 헤더 이름 → 0-based 인덱스. 열이 밀려도 이 함수만 통하면 안전하다. */
export const colOf = (name: string): number => {
  const i = OPTMAP_HEADERS.indexOf(name);
  if (i < 0) throw new Error(`⭐옵션매핑 헤더 없음: ${name}`);
  return i;
};
/** 0-based 인덱스 → A1 열 문자 */
export const colA1 = (name: string): string => String.fromCharCode(65 + colOf(name));

/**
 * 검수 열 수식 — **행마다 쓰지 않고 2행에 ARRAYFORMULA 한 번만** 넣는다.
 * 행마다 넣으면 append 로 줄이 늘 때 수식이 안 따라와 빈칸이 생기고,
 * upsert 가 값을 덮어써 수식이 날아간다. ARRAYFORMULA 는 열 전체를 커버하고
 * 새 줄에도 자동 적용되며, 품목사전 원가를 고치면 **즉시** 다시 계산된다.
 */
export const OPTMAP_ARRAY_FORMULAS: Record<string, string> = {
  // L=개당원가, M=별칭 은 J(품목 선택) 을 품목사전에서 조회. N=옵션원가 = 개당원가 × K(병수).
  L2: `=ARRAYFORMULA(IF($J$2:$J="","",IFERROR(VLOOKUP($J$2:$J,${"품목사전"}!$A:$B,2,FALSE),"품목사전에 없음")))`,
  M2: `=ARRAYFORMULA(IF($J$2:$J="","",IFERROR(VLOOKUP($J$2:$J,${"품목사전"}!$A:$C,3,FALSE),"")))`,
  N2: `=ARRAYFORMULA(IF(($J$2:$J="")+(NOT(ISNUMBER($L$2:$L))),"",$L$2:$L*IF($K$2:$K="",1,$K$2:$K)))`,
};

/** 헤더 1행에 달릴 설명 노트 (사장님용). OPTMAP_HEADERS 와 순서가 1:1. */
export const OPTMAP_NOTES = [
  "이 상품이 어느 스토어 것인지. 자동으로 채워집니다 — 손대지 마세요.",
  "네이버가 매기는 원본 상품번호. 자동으로 채워집니다 — 손대지 마세요.",
  "네이버 채널 상품번호. 자동으로 채워집니다 — 손대지 마세요.",
  "비어 있으면 = 이 상품의 대표 줄(상품 전체 기본값).\n값이 있으면 = 그 옵션 전용 줄.\n자동으로 채워집니다 — 손대지 마세요.",
  "보고서에 표시될 이름. 비워두면 상품명이 쓰입니다. 바꿔도 됩니다.",
  "★사장님 입력★ 1개당 매입원가(숫자만).\n대표 줄(옵션관리번호 빈 줄)에 넣으면 그 상품 모든 옵션에 자동 적용됩니다.\n특정 옵션만 다르면 그 옵션 줄에 따로 적으세요 — 그 줄이 우선합니다.\n비워두면 이익이 '설정 필요'로 표시됩니다.",
  "⚠️ 사용 안 함 (전역 설정으로 대체)\n물류비는 이제 「설정」 탭의 «출고 건당 물류비» 한 칸으로 일괄 적용됩니다.\n이 열의 값은 계산에 쓰이지 않습니다. 과거 입력값 보존을 위해 열만 남겨둔 것입니다.",
  "메인 / 추가 중 하나. 비워둬도 됩니다.",
  "★사장님 메모★ 자유롭게 적으세요. 계산에 쓰이지 않습니다.",
  "★사장님 선택★ 이 옵션이 실제로 어떤 품목인지 목록에서 고르세요.\n고르면 오른쪽에 개당원가·별칭·옵션원가가 바로 뜹니다.\n※ 여러 품목이 섞인 옵션(피쿠알2+블렌딩1)은 「구성해석」 탭에서 지정하세요.",
  "옵션 이름에서 자동으로 읽은 병(개) 수. 비어 있으면 1개로 봅니다.",
  "왼쪽에서 고른 품목의 개당원가 (품목사전에서 자동). 품목사전을 고치면 즉시 바뀝니다.",
  "그 품목의 별칭 (품목사전에서 자동). 매핑이 맞는지 눈으로 확인하는 용도입니다.",
  "= 개당원가 × 병수. 이 옵션 1건의 원가입니다.",
  "드롭다운을 안 고른 줄에 대해 시스템이 스스로 읽은 구성입니다.\n예: 피쿠알×2+블렌딩×1",
  "위 「자동해석」대로 계산한 원가입니다.",
  "실제로 무엇을 근거로 계산했는지: 드롭다운 / 수동구성 / 자동 / 설정 필요",
];

/** 탭 보장 + 헤더 + 노트 + 드롭다운 + 검수 수식. 부가 설정 실패는 삼킨다(본 계산과 무관). */
export async function ensureOptionMapTab(c: SheetCreds): Promise<void> {
  await ensureTab(c, OPTMAP_TAB, OPTMAP_HEADERS);
  try {
    await setHeaderNotes(c, OPTMAP_TAB, OPTMAP_NOTES);
  } catch (err) {
    console.warn(`[${OPTMAP_TAB}] 헤더 노트 실패(무시): ${err instanceof Error ? err.message : err}`);
  }
  try {
    // 품목사전 A열을 소스로 하는 드롭다운. 범위를 넉넉히(2~1000) 잡아 품목이 늘어도 자동 반영.
    await setOneOfRangeValidation(c, OPTMAP_TAB, colOf(OPTMAP_COL.itemPick), ITEM_TAB_NAME, "A");
  } catch (err) {
    console.warn(`[${OPTMAP_TAB}] 드롭다운 설정 실패(무시): ${err instanceof Error ? err.message : err}`);
  }
  try {
    for (const [cell, formula] of Object.entries(OPTMAP_ARRAY_FORMULAS)) {
      await writeRange(c, `${OPTMAP_TAB}!${cell}`, [[formula]]);
    }
  } catch (err) {
    console.warn(`[${OPTMAP_TAB}] 검수 수식 설정 실패(무시): ${err instanceof Error ? err.message : err}`);
  }
}

export interface AuditCtx {
  store: string;
  channelProductNo: string;
  optionManageCode: string;
  label: string;
  pickedItem: string;
}

/**
 * 검수 열 중 «스크립트가 채우는» 부분 갱신 — 병수, 자동해석·해석원가·출처.
 * 개당원가·별칭·옵션원가는 ARRAYFORMULA 라 건드리지 않는다 (쓰면 수식이 날아간다).
 * 열 위치는 전부 헤더 이름으로 계산하므로 열이 밀려도 안전하다.
 */
export async function refreshOptMapAudit(
  c: SheetCreds,
  resolve: (ctx: AuditCtx) => {
    bottles: number; autoText: string; autoCost: number | ""; source: string;
  },
): Promise<{ rows: number; flagged: number }> {
  const lastInput = colA1(OPTMAP_COL.itemPick);
  const rows = await readRange(c, `${OPTMAP_TAB}!A2:${lastInput}20000`);
  if (rows.length === 0) return { rows: 0, flagged: 0 };

  const iStore = colOf(OPTMAP_COL.store);
  const iCh = colOf(OPTMAP_COL.channelNo);
  const iCode = colOf(OPTMAP_COL.optionCode);
  const iLabel = colOf(OPTMAP_COL.label);
  const iPick = colOf(OPTMAP_COL.itemPick);

  const bottlesCol: (string | number)[][] = [];
  const autoCols: (string | number)[][] = [];
  let flagged = 0;
  for (const r of rows) {
    const { bottles, autoText, autoCost, source } = resolve({
      store: String(r[iStore] ?? "").trim(),
      channelProductNo: String(r[iCh] ?? "").trim(),
      optionManageCode: String(r[iCode] ?? "").trim(),
      label: String(r[iLabel] ?? "").trim(),
      pickedItem: String(r[iPick] ?? "").trim(),
    });
    bottlesCol.push([bottles]);
    autoCols.push([autoText, autoCost, source]);
    if (source === "설정 필요") flagged += 1;
  }
  const last = rows.length + 1;
  const bCol = colA1(OPTMAP_COL.bottles);
  await writeRange(c, `${OPTMAP_TAB}!${bCol}2:${bCol}${last}`, bottlesCol);
  await writeRange(
    c,
    `${OPTMAP_TAB}!${colA1(OPTMAP_COL.autoText)}2:${colA1(OPTMAP_COL.source)}${last}`,
    autoCols,
  );
  return { rows: rows.length, flagged };
}

/** 자동 추가 후보 한 줄. */
export interface OptMapEntry {
  store: string;
  originProductNo: string;
  channelProductNo: string;
  optionManageCode: string; // "" = 상품 대표 줄
  label: string;
}

/**
 * 「⭐옵션매핑」에서 제외하는 스토어.
 * 여기명품은 같은 상품도 사입가가 건건이 달라(도매 시세) 품목사전 단가 방식이 맞지 않는다.
 * 원가는 「여기명품 사입관리」 시트의 실매입가(AD↔AB)로 이미 정확히 들어오므로,
 * 옵션매핑에 줄을 만들면 수천 줄 잡음만 쌓이고 검수 화면이 무의미해진다.
 */
export const OPTMAP_EXCLUDED_STORES = new Set(["여기명품"]);

/** 시트에 이미 있는 키 집합 + 원본상품번호가 빈 줄 위치를 함께 돌려준다. */
interface ExistingState {
  keys: Set<string>;
  channels: Set<string>;
  rowCount: number;
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
  return { keys, channels, rowCount: rows.length };
}

/**
 * 없는 줄만 append. 기존 줄은 읽기만 하고 절대 건드리지 않는다.
 *
 * 그룹 유지: 새 상품은 「대표 줄 → 그 상품 옵션 줄들」 순서로 이어 붙인다.
 * 기존 줄 순서는 재정렬하지 않는다(사장님이 보던 위치가 흔들리지 않게).
 *
 * @returns 새로 추가된 상품(채널상품번호) 목록과 추가된 줄 수
 */
export async function mergeOptionMapEntries(
  c: SheetCreds,
  entries: OptMapEntry[],
): Promise<{ addedRows: number; newProducts: { channelProductNo: string; label: string }[] }> {
  await ensureOptionMapTab(c);
  const existing = await readExisting(c);

  // 채널상품번호별로 묶어서 대표 줄이 먼저 나오게 정렬
  const byChannel = new Map<string, OptMapEntry[]>();
  for (const e of entries) {
    const chNo = e.channelProductNo.trim();
    if (!chNo) continue;
    if (OPTMAP_EXCLUDED_STORES.has(e.store)) continue; // 여기명품 등은 사입관리로 원가가 오므로 제외
    const list = byChannel.get(chNo) ?? [];
    list.push(e);
    byChannel.set(chNo, list);
  }

  const toAppend: (string | number)[][] = [];
  const newProducts: { channelProductNo: string; label: string }[] = [];

  for (const [chNo, list] of byChannel) {
    const isNewProduct = !existing.channels.has(chNo);
    // 대표 줄(옵션관리번호 "")이 후보에 없으면 만들어 준다 — 사장님이 숫자 하나만 넣을 자리
    const hasProductLevel = list.some((e) => !e.optionManageCode);
    const ordered: OptMapEntry[] = [];
    if (!hasProductLevel) {
      const seed = list[0];
      ordered.push({
        store: seed.store,
        originProductNo: seed.originProductNo,
        channelProductNo: chNo,
        optionManageCode: "",
        label: seed.label,
      });
    }
    ordered.push(...list.filter((e) => !e.optionManageCode), ...list.filter((e) => e.optionManageCode));

    let addedForThis = 0;
    for (const e of ordered) {
      const k = keyOf(chNo, e.optionManageCode);
      if (existing.keys.has(k)) continue;
      existing.keys.add(k); // 같은 실행 안에서의 중복 방지
      // 「품목(선택)」까지만 쓴다. 그 뒤(개당원가·별칭·옵션원가)는 비워둬야
      // ARRAYFORMULA 가 그 줄까지 자동으로 채운다. 빈 문자열이라도 쓰면 배열 수식이 깨진다.
      const row = new Array(colOf(OPTMAP_COL.itemPick) + 1).fill("");
      row[colOf(OPTMAP_COL.store)] = e.store;
      row[colOf(OPTMAP_COL.originNo)] = e.originProductNo;
      row[colOf(OPTMAP_COL.channelNo)] = chNo;
      row[colOf(OPTMAP_COL.optionCode)] = e.optionManageCode;
      row[colOf(OPTMAP_COL.label)] = e.label;
      toAppend.push(row);
      addedForThis += 1;
    }
    if (isNewProduct && addedForThis > 0) {
      newProducts.push({ channelProductNo: chNo, label: list[0].label });
    }
  }

  if (toAppend.length > 0) {
    await appendRows(c, `${OPTMAP_TAB}!A1`, toAppend);
  }
  return { addedRows: toAppend.length, newProducts };
}
