/**
 * 「설정」 탭 — 사장님이 시트에서 바꾸는 전역 값.
 *
 * 코드나 .env 를 안 건드리고 숫자 한 칸으로 정책을 바꾸기 위한 곳.
 * 값이 비었거나 탭이 없으면 아래 기본값을 쓴다(시트 사고로 계산이 0 이 되는 걸 막는다).
 */

import { ensureTab, readRange, upsertRows, setHeaderNotes, type SheetCreds } from "./sheets";

export const SETTINGS_TAB = "설정";
export const SETTINGS_HEADERS = ["항목", "값", "설명"];
const SETTINGS_NOTES = [
  "설정 이름. 자동으로 채워집니다 — 손대지 마세요.",
  "★사장님 입력★ 이 칸의 숫자만 바꾸면 다음 보고부터 적용됩니다.",
  "이 설정이 무엇인지 설명입니다.",
];

/** 출고 건당(묶음배송 1회당) 물류비. */
export const KEY_LOGISTICS = "출고 건당 물류비";
export const DEFAULT_LOGISTICS_PER_SHIPMENT = 4500;

const SETTING_DEFS: { key: string; value: number; desc: string }[] = [
  {
    key: KEY_LOGISTICS,
    value: DEFAULT_LOGISTICS_PER_SHIPMENT,
    desc: "한 번 출고할 때 나가는 평균 비용(택배비+포장비). 묶음배송이면 주문 1건에 1회만 차감됩니다. 상품별로 따로 잡지 않고 이 값 하나로 일괄 적용합니다.",
  },
];

export interface Settings {
  logisticsPerShipment: number;
}

/**
 * 「설정」 탭 보장 + 로드. 없는 항목은 기본값으로 줄을 만들어 둔다(사장님이 값만 고치면 됨).
 * 기존에 입력된 값은 덮어쓰지 않는다.
 */
export async function loadSettings(c: SheetCreds): Promise<Settings> {
  const out: Settings = { logisticsPerShipment: DEFAULT_LOGISTICS_PER_SHIPMENT };
  try {
    await ensureTab(c, SETTINGS_TAB, SETTINGS_HEADERS);
    const rows = await readRange(c, `${SETTINGS_TAB}!A2:C100`);
    const have = new Map<string, string>();
    for (const r of rows) {
      const k = String(r[0] ?? "").trim();
      if (k) have.set(k, String(r[1] ?? "").trim());
    }
    // 없는 설정만 기본값으로 추가 (이미 있는 값은 그대로 둔다)
    const missing = SETTING_DEFS.filter((d) => !have.has(d.key));
    if (missing.length > 0) {
      await upsertRows(
        c,
        SETTINGS_TAB,
        missing.map((d) => [d.key, d.value, d.desc]),
        (r) => String(r[0] ?? ""),
      );
      for (const d of missing) have.set(d.key, String(d.value));
    }
    try { await setHeaderNotes(c, SETTINGS_TAB, SETTINGS_NOTES); } catch { /* 무시 */ }

    const raw = have.get(KEY_LOGISTICS) ?? "";
    const n = Number(String(raw).replace(/,/g, ""));
    // 0 이나 공란이면 기본값 — 시트를 잘못 건드려 물류비가 통째로 사라지는 사고 방지
    if (Number.isFinite(n) && n > 0) out.logisticsPerShipment = n;
    else if (raw !== "") {
      console.warn(`[설정] 「${KEY_LOGISTICS}」 값이 이상함("${raw}") → 기본값 ${DEFAULT_LOGISTICS_PER_SHIPMENT} 사용`);
    }
  } catch (err) {
    console.warn(`[설정] 로드 실패 → 기본값 사용: ${err instanceof Error ? err.message : err}`);
  }
  return out;
}
