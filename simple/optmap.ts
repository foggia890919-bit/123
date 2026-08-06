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

import { ensureTab, readRange, appendRows, setHeaderNotes, type SheetCreds } from "./sheets";

export const OPTMAP_TAB = "⭐옵션매핑";

export const OPTMAP_HEADERS = [
  "원본상품번호",
  "채널상품번호",
  "옵션관리번호",
  "라벨",
  "원가(개당)",
  "물류비(건당)",
  "유형(메인/추가)",
  "메모",
];

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
];

/** 탭 보장 + 헤더 + 헤더 노트. 노트 실패는 치명적이지 않으므로 삼킨다. */
export async function ensureOptionMapTab(c: SheetCreds): Promise<void> {
  await ensureTab(c, OPTMAP_TAB, OPTMAP_HEADERS);
  try {
    await setHeaderNotes(c, OPTMAP_TAB, OPTMAP_NOTES);
  } catch (err) {
    console.warn(`[${OPTMAP_TAB}] 헤더 노트 적용 실패(무시): ${err instanceof Error ? err.message : err}`);
  }
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
      // 원가·물류비·유형·메모는 비워서 추가 — 사장님이 채울 칸
      toAppend.push([e.originProductNo, chNo, e.optionManageCode, e.label, "", "", "", ""]);
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
