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
 * ⚠️ 열 순서 변경·중간 삽입 금지.
 * 이 시트는 열 인덱스로 읽는 코드가 여러 군데(다른 머신의 미push 코드 포함) 있어
 * 앞이나 중간에 열을 끼우면 조용히 어긋난다. **새 열은 반드시 맨 뒤에만** 추가할 것.
 */
export const OPTMAP_HEADERS = [
  "원본상품번호",
  "채널상품번호",
  "옵션관리번호",
  "라벨",
  "원가(개당)",
  "물류비(건당)",
  "유형(메인/추가)",
  "메모",
  "품목(선택)",   // I (idx 8) — 품목사전 드롭다운 (사장님 입력)
  "병수",         // J (idx 9) — 스크립트
  "개당원가",     // K (idx10) — 수식(ARRAYFORMULA)
  "별칭",         // L (idx11) — 수식
  "옵션원가",     // M (idx12) — 수식 = 개당원가 × 병수
  "자동해석",     // N (idx13) — 스크립트
  "해석원가",     // O (idx14) — 스크립트
  "출처",         // P (idx15) — 스크립트
];

export const OPTMAP_ITEM_COL = 8;   // I — 드롭다운
export const OPTMAP_AUDIT_FROM = 9; // J 부터 검수 열

/**
 * 검수 열 수식 — **행마다 쓰지 않고 2행에 ARRAYFORMULA 한 번만** 넣는다.
 * 행마다 넣으면 append 로 줄이 늘 때 수식이 안 따라와 빈칸이 생기고,
 * upsert 가 값을 덮어써 수식이 날아간다. ARRAYFORMULA 는 열 전체를 커버하고
 * 새 줄에도 자동 적용되며, 품목사전 원가를 고치면 **즉시** 다시 계산된다.
 */
export const OPTMAP_ARRAY_FORMULAS: Record<string, string> = {
  K2: `=ARRAYFORMULA(IF($I$2:$I="","",IFERROR(VLOOKUP($I$2:$I,${"품목사전"}!$A:$B,2,FALSE),"품목사전에 없음")))`,
  L2: `=ARRAYFORMULA(IF($I$2:$I="","",IFERROR(VLOOKUP($I$2:$I,${"품목사전"}!$A:$C,3,FALSE),"")))`,
  M2: `=ARRAYFORMULA(IF(($I$2:$I="")+(NOT(ISNUMBER($K$2:$K))),"",$K$2:$K*IF($J$2:$J="",1,$J$2:$J)))`,
};

/** 헤더 1행에 달릴 설명 노트 (사장님용). */
export const OPTMAP_NOTES = [
  "네이버가 매기는 원본 상품번호. 자동으로 채워집니다 — 손대지 마세요.",
  "네이버 채널 상품번호. 자동으로 채워집니다 — 손대지 마세요.",
  "비어 있으면 = 이 상품의 대표 줄(상품 전체 기본값).\n값이 있으면 = 그 옵션 전용 줄.\n자동으로 채워집니다 — 손대지 마세요.",
  "보고서에 표시될 이름. 비워두면 상품명이 쓰입니다. 바꿔도 됩니다.",
  "★사장님 입력★ 1개당 매입원가(숫자만).\n대표 줄(옵션관리번호 빈 줄)에 넣으면 그 상품 모든 옵션에 자동 적용됩니다.\n특정 옵션만 다르면 그 옵션 줄에 따로 적으세요 — 그 줄이 우선합니다.\n비워두면 이익이 '설정 필요'로 표시됩니다.",
  "★사장님 입력★ 한 번 보낼 때 나가는 실제 택배비(숫자만).\n묶음배송이면 주문 1건에 1회만 차감됩니다.",
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
    await setOneOfRangeValidation(c, OPTMAP_TAB, OPTMAP_ITEM_COL, ITEM_TAB_NAME, "A");
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

/**
 * 검수 열 중 «스크립트가 채우는» 부분 갱신 — J(병수), N/O/P(자동해석·해석원가·출처).
 * K·L·M 은 ARRAYFORMULA 라 건드리지 않는다 (건드리면 수식이 날아간다).
 *
 * @param resolve 옵션 라벨 → 해석 결과. run.ts 가 품목사전/구성해석을 물려 넘긴다.
 */
export async function refreshOptMapAudit(
  c: SheetCreds,
  resolve: (label: string, pickedItem: string, channelProductNo: string) => {
    bottles: number; autoText: string; autoCost: number | ""; source: string;
  },
): Promise<{ rows: number; flagged: number }> {
  const rows = await readRange(c, `${OPTMAP_TAB}!A2:I20000`);
  if (rows.length === 0) return { rows: 0, flagged: 0 };

  const colJ: (string | number)[][] = [];
  const colNOP: (string | number)[][] = [];
  let flagged = 0;
  for (const r of rows) {
    const label = String(r[3] ?? "").trim();
    const picked = String(r[OPTMAP_ITEM_COL] ?? "").trim();
    const { bottles, autoText, autoCost, source } = resolve(label, picked, String(r[1] ?? "").trim());
    colJ.push([bottles]);
    colNOP.push([autoText, autoCost, source]);
    if (source === "설정 필요") flagged += 1;
  }
  const last = rows.length + 1;
  await writeRange(c, `${OPTMAP_TAB}!J2:J${last}`, colJ);
  await writeRange(c, `${OPTMAP_TAB}!N2:P${last}`, colNOP);
  return { rows: rows.length, flagged };
}

/** 자동 추가 후보 한 줄. */
export interface OptMapEntry {
  originProductNo: string;
  channelProductNo: string;
  optionManageCode: string; // "" = 상품 대표 줄
  label: string;
}

/** 시트에 이미 있는 키 집합 + 원본상품번호가 빈 줄 위치를 함께 돌려준다. */
interface ExistingState {
  keys: Set<string>;
  channels: Set<string>;
  rowCount: number;
}

const keyOf = (chNo: string, optCode: string) => (optCode ? `${chNo}|${optCode}` : chNo);

async function readExisting(c: SheetCreds): Promise<ExistingState> {
  const rows = await readRange(c, `${OPTMAP_TAB}!A2:H10000`);
  const keys = new Set<string>();
  const channels = new Set<string>();
  for (const r of rows) {
    const chNo = String(r[1] ?? "").trim();
    if (!chNo) continue;
    const optCode = String(r[2] ?? "").trim();
    keys.add(keyOf(chNo, optCode));
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
      // A~I 만 쓴다 (9칸). J 이후는 비워둬야 K·L·M 의 ARRAYFORMULA 가 그 줄까지 자동으로 채운다.
      // 여기서 J 이후에 빈 문자열이라도 쓰면 배열 수식이 #REF 로 깨진다.
      toAppend.push([e.originProductNo, chNo, e.optionManageCode, e.label, "", "", "", "", ""]);
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
