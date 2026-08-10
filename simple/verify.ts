/**
 * 「검산」 탭 — 최근 7일 주문을 한 줄씩 해부해서 이익 계산이 맞는지 상시 검증.
 *
 * 왜 만들었나:
 *   이익률 허수가 연달아 나왔다 (대표 줄 드롭다운 상속으로 3병 옵션이 5,200 으로 계산,
 *   2+1 특가가 피쿠알×2 로 과소계상 등). 사람이 매번 눈으로 잡을 수는 없으니
 *   **매일 아침 자동으로 같은 검사를 돌려** 의심 줄에 노란색 + 사유를 남긴다.
 *
 * 데이터 출처는 「주문원본」이다 (API 재조회 X). 즉 **실제로 시트에 저장된 값**을 검사한다.
 * 원가는 run.ts 와 완전히 동일한 규칙으로 다시 풀어서, 저장된 값과 어긋나는지 본다.
 *
 * CLI: npx tsx verify.ts            (어제 기준 7일)
 *      npx tsx verify.ts 2026-08-09 (그 날 기준 7일)
 *      npx tsx verify.ts 2026-08-09 14
 */

import "dotenv/config";
import {
  ensureTab, readRange, writeRange, clearRange, setHeaderNotes,
  setFrozenRows, setColumnWidths, applyRowFormatRule, getSheetIdMap,
  loadCredsFromEnv, type SheetCreds,
} from "./sheets";
import { loadSettings, DEFAULT_LOGISTICS_PER_SHIPMENT } from "./settings";
import {
  loadItems, loadCompRules, parseComposition, costOfComposition, compKey,
  formatCompositionUi, bottlesOfLabel,
  type Item, type CompRule, type CompPart,
} from "./itemdict";
import { OPTMAP_TAB, OPTMAP_COL, OPTMAP_EXCLUDED_STORES, colOf, colA1 } from "./optmap";

export const VERIFY_TAB = "검산";

export const VERIFY_HEADERS = [
  "스토어", "결제일", "주문번호", "옵션관리번호", "상품명", "옵션명",
  "구분", "판매단가", "수량", "매출", "수수료", "정산예정",
  "원가해석", "원가", "물류비배분", "수취배송비", "이익", "이익률%", "⚠️플래그",
];

/** 오른쪽 별도 영역 — 추가상품 전수 목록 (U열부터). */
const ADDON_START_COL = 20; // U (0-based)
const ADDON_HEADERS = [
  "🎁 추가상품", "옵션관리번호", "상품번호", "평균판매가", "매칭원가", "판매수량", "매출합", "이익합", "이익률%",
];

const VERIFY_NOTES = [
  "어느 스토어 주문인지.",
  "결제일(KST). 최근 7일치만 담깁니다.",
  "네이버 주문번호. 같은 주문번호가 여러 줄이면 묶음배송입니다.",
  "그 주문이 어느 옵션 줄로 팔렸는지. 「⭐옵션매핑」에서 이 번호로 찾으세요.",
  "상품명.",
  "판매 옵션 텍스트.",
  "본품 / 추가. 「⭐옵션매핑」의 유형이 있으면 그 값, 없으면 주문 안에서 매출이 가장 큰 줄을 본품으로 봅니다.",
  "(매출 − 수취배송비) ÷ 수량.",
  "주문 수량.",
  "매출 = 결제금액 + 수취배송비 (「주문원본」 값 그대로).",
  "네이버 총 차감액 = 매출 − 정산예정.",
  "정산예정 (네이버가 실제로 주는 돈).",
  "★핵심★ 원가를 무엇으로 계산했는지 그대로 보여줍니다.\n수동 = 「구성해석」 수동구성 / 드롭다운 = 「⭐옵션매핑」 품목 선택 / 자동 = 옵션 텍스트 자동 해석 / 사입관리 = 여기명품 / 미해석 = 근거 없음",
  "「주문원본」에 저장된 원가.",
  "그 줄에 배분된 물류비. 묶음배송이면 주문의 첫 줄에만 붙고 나머지는 0 입니다.",
  "고객에게 받은 배송비.",
  "「주문원본」에 저장된 이익.",
  "이익 ÷ 매출 × 100.",
  "비어 있으면 이상 없음.\n🟡 노란 줄 = 확인이 필요한 줄, 🔵 파란 줄 = 정보성(문제 아님).\n\n검사 항목\n① 검산식 불일치: 정산−원가−물류+배송비 ≠ 저장된 이익\n② 드롭다운↔자동해석 값 불일치 (의도적일 수 있음 — 확인 요망)\n②-b 옵션에 「3박스」 같은 수량이 있는데 1개 원가로 계산됨\n③ 배송비 이상: 같은 옵션인데 어떤 주문은 배송비 0\n④ 이익률 40% 초과 / 음수(역마진)\n⑤ 원가 0·미해석인데 이익이 잡힘\n⑥ 묶음배송 물류비: 주문당 정확히 1회인지",
];

/** 정보성(문제 아님) 플래그 접두어 — 노란색 대신 파란색으로 구분한다. */
const INFO_MARK = "ℹ";

// 「주문원본」 컬럼 인덱스 — run.ts 의 RAW_HEADERS 와 1:1. 순서가 바뀌면 여기도 고칠 것.
const RAW = {
  date: 0, store: 1, orderId: 2, productOrderId: 3, channelNo: 4,
  productName: 5, option: 6, keyword: 7, qty: 8, outQty: 9,
  sales: 10, commission: 11, settlement: 12, status: 13, buyer: 14,
  cost: 15, logistics: 16, profit: 17, deliveryFee: 18, optionCode: 19,
} as const;
const RAW_LAST_COL = "T";

const SETUP_NEEDED = "설정 필요";
const YEOGI_STORE = "여기명품";

/** 이익률 이상치 상한 — 이걸 넘으면 원가가 덜 잡혔을 가능성이 높다. */
const PROFIT_RATE_MAX = 40;

const isCanceled = (s: string) => /취소|반품|환불|cancel|refund|return/i.test(s);
const num = (v: unknown) => Number(String(v ?? "").replace(/,/g, "")) || 0;
/** 숫자면 숫자, 「설정 필요」·공란이면 null (0 으로 뭉개면 이익이 부풀어 보인다). */
const numOrNull = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  if (!s || s === SETUP_NEEDED) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;
const won = (n: number) => n.toLocaleString("ko-KR");

/** 0-based 열 인덱스 → A1 열 문자 (20 → "U", 28 → "AC"). 26열을 넘으면 두 글자가 된다. */
function colLetter(idx: number): string {
  let out = "";
  let n = idx;
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

export interface VerifyFlagSample {
  type: string;
  store: string;
  date: string;
  orderId: string;
  optionCode: string;
  productName: string;
  optionName: string;
  detail: string;
}

export interface AddonSummaryRow {
  name: string;
  optionCode: string;
  channelNo: string;
  avgPrice: number;
  unitCost: number | null;
  qty: number;
  sales: number;
  profit: number | null;
  rate: number | null;
}

export interface VerifyResult {
  /** 검사한 줄 수 (취소건 제외) */
  rows: number;
  /** 확인이 필요한 줄 수 (정보성 제외) */
  flagged: number;
  /** 정보성 표시만 붙은 줄 수 */
  infoOnly: number;
  /** 「확인 필요」 유형별 건수 (정보성 제외) */
  byType: Record<string, number>;
  /** 정보성 표시 유형별 건수 */
  byTypeInfo: Record<string, number>;
  /** 유형별 대표 사례 (최대 3건씩) */
  samples: VerifyFlagSample[];
  /** 추가상품 요약 */
  addons: AddonSummaryRow[];
  /** 「검산」 탭 링크 */
  link: string;
  window: { from: string; to: string };
}

const FLAG = {
  formula: "검산식 불일치",
  pickVsAuto: "드롭다운↔자동 불일치",
  qtyIgnored: "수량표기 미반영",
  delivery: "배송비 이상",
  rate: "이익률 이상치",
  zeroCost: "원가 0인데 이익",
  // ⚠️ 「<」·「>」 를 이름에 쓰지 말 것 — 이 이름이 텔레그램 HTML 메시지에 그대로 들어간다.
  //    「매출<정산」 으로 뒀더니 태그로 해석돼 요약 한 줄이 통째로 잘려나갔다.
  coupon: "매출·정산 역전(네이버 쿠폰)",
  logistics: "물류비 횟수 이상",
} as const;

/**
 * 옵션 텍스트에 「3박스」·「2세트」처럼 **2 이상의 명시 수량**이 있는지.
 * 원가 구성 총 수량이 1인데 이런 표기가 있으면 병수를 못 읽은 것 —
 * 실제로 「3박스(42포)」 옵션이 1개 원가(3,400)로 잡혀 이익률이 46% 로 부풀어 있었다.
 * (bottlesOfLabel 이 「박스」·「포」 단위를 세지 않는다)
 */
function explicitQtyToken(text: string): string | null {
  const m = String(text ?? "").match(/(\d{1,2})\s*(박스|세트|팩|포|병|개|입)/);
  if (!m) return null;
  return parseInt(m[1], 10) >= 2 ? m[0] : null;
}

/** 「⭐옵션매핑」에서 (상품번호|옵션관리번호) → 드롭다운 선택·유형 */
export interface OptMapLite { itemPick: string; type: string }

export async function loadOptMapLite(c: SheetCreds): Promise<Map<string, OptMapLite>> {
  const map = new Map<string, OptMapLite>();
  try {
    const rows = await readRange(c, `${OPTMAP_TAB}!A2:${colA1(OPTMAP_COL.itemPick)}20000`);
    const iCh = colOf(OPTMAP_COL.channelNo);
    const iCode = colOf(OPTMAP_COL.optionCode);
    const iType = colOf(OPTMAP_COL.type);
    const iPick = colOf(OPTMAP_COL.itemPick);
    for (const r of rows) {
      const ch = String(r[iCh] ?? "").trim();
      if (!ch) continue;
      const code = String(r[iCode] ?? "").trim();
      map.set(code ? `${ch}|${code}` : ch, {
        itemPick: String(r[iPick] ?? "").trim(),
        type: String(r[iType] ?? "").trim(),
      });
    }
  } catch (err) {
    console.warn(`[검산] ${OPTMAP_TAB} 읽기 실패(드롭다운 검증 생략): ${err instanceof Error ? err.message : err}`);
  }
  return map;
}

/** endDate 포함 최근 days 일 (YYYY-MM-DD) */
function windowOf(endDate: string, days: number): { from: string; to: string } {
  const [y, m, d] = endDate.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d - (days - 1)));
  return { from: start.toISOString().slice(0, 10), to: endDate };
}

export interface Resolved {
  text: string;       // 원가해석 표시 문자열
  source: string;     // 수동 / 드롭다운 / 자동 / 사입관리 / 미해석
  unitCost: number | null; // 옵션 1건당 원가 (수량 곱하기 전)
  pickCost: number | null; // 드롭다운만으로 계산했을 때의 원가
  autoCost: number | null; // 자동 해석만으로 계산했을 때의 원가
  /** 자동해석이 «여러 품목» 이면 true. 드롭다운 한 칸으로는 표현이 불가능해 자동해석이 정답. */
  autoIsComposite: boolean;
  /** 적용된 구성의 총 개수 (병수 합). 0 = 미해석 */
  totalUnits: number;
}

/**
 * run.ts 의 원가 결정 로직을 **그대로** 재현한다.
 * (여기가 어긋나면 검산 자체가 거짓말이 되므로 규칙을 바꿀 땐 양쪽을 같이 고칠 것)
 *   우선순위: 「구성해석」 수동 > 그 줄 드롭다운(조합=×1, 단품=×명시병수) > 자동해석
 *   대표 줄 드롭다운은 «옵션 없이 팔린 줄»에만 쓴다 (상속 금지).
 */
export function resolveCost(
  productName: string,
  optText: string,
  channelNo: string,
  optionCode: string,
  items: Item[],
  compRules: Map<string, CompRule>,
  optMap: Map<string, OptMapLite>,
): Resolved {
  const manual = compRules.get(compKey(channelNo, optText))?.manual ?? null;
  const optionPick = optMap.get(`${channelNo}|${optionCode}`)?.itemPick ?? "";
  const productPick = optionCode ? "" : (optMap.get(channelNo)?.itemPick ?? "");
  const auto = parseComposition(productName, optText, items);
  const autoIsComposite = !!auto && new Set(auto.map((p) => p.item)).size >= 2;
  const rawPick = optionPick || productPick;
  const usablePick = autoIsComposite ? "" : rawPick;

  const pickParts = (name: string): CompPart[] => [{
    item: name,
    qty: name.includes("+") ? 1 : bottlesOfLabel(optText || productName),
  }];

  const costOf = (parts: CompPart[] | null): number | null => {
    if (!parts) return null;
    const { cost, missing } = costOfComposition(parts, items);
    return missing ? null : cost;
  };

  const pickCost = rawPick ? costOf(pickParts(rawPick)) : null;
  const autoCost = costOf(auto);

  const parts = manual ?? (usablePick ? pickParts(usablePick) : null) ?? auto;
  const source = manual ? "수동" : usablePick ? "드롭다운" : auto ? "자동" : "미해석";
  const unitCost = costOf(parts);
  const text = parts
    ? `${source} ${formatCompositionUi(parts)}${unitCost != null ? ` = ${won(unitCost)}` : " = 원가없음"}`
    : "미해석";
  return {
    text, source, unitCost, pickCost, autoCost, autoIsComposite,
    totalUnits: parts ? parts.reduce((s, p) => s + p.qty, 0) : 0,
  };
}

interface WorkRow {
  store: string; date: string; orderId: string; optionCode: string; channelNo: string;
  productName: string; optionName: string; kind: string;
  unitPrice: number; qty: number; sales: number; commission: number;
  settlement: number | null; costText: string; cost: number | null;
  logistics: number | null; deliveryFee: number; profit: number | null;
  rate: number | null; flags: string[]; infoFlags: string[];
}

/**
 * 「검산」 탭 갱신.
 * @param endDate 기준일 (보통 보고일 = 어제). 이 날 포함 최근 `days` 일을 검사한다.
 */
export async function updateVerifyTab(
  c: SheetCreds,
  endDate: string,
  days = 7,
): Promise<VerifyResult> {
  const win = windowOf(endDate, days);
  const settings = await loadSettings(c).catch(
    () => ({ logisticsPerShipment: DEFAULT_LOGISTICS_PER_SHIPMENT }),
  );
  const items = await loadItems(c);
  const compRules = await loadCompRules(c, items);
  const optMap = await loadOptMapLite(c);

  const raw = await readRange(c, `주문원본!A2:${RAW_LAST_COL}100000`);
  const inWindow = raw.filter((r) => {
    const d = String(r[RAW.date] ?? "").slice(0, 10);
    return d >= win.from && d <= win.to;
  });

  // ── 주문 단위 사전 계산 (물류비 횟수·본품 판정·배송비) ──
  interface OrderInfo {
    rows: string[][];
    hasCanceled: boolean;
    allYeogi: boolean;
    logisticsSum: number;
    feeSum: number;
    liveCount: number;
    mainKey: string; // 본품으로 볼 줄의 상품주문번호
  }
  const orders = new Map<string, OrderInfo>();
  for (const r of inWindow) {
    const oid = String(r[RAW.orderId] ?? "").trim();
    if (!oid) continue;
    const o = orders.get(oid) ?? {
      rows: [], hasCanceled: false, allYeogi: true,
      logisticsSum: 0, feeSum: 0, liveCount: 0, mainKey: "",
    };
    o.rows.push(r);
    if (isCanceled(String(r[RAW.status] ?? ""))) o.hasCanceled = true;
    else o.liveCount += 1;
    if (String(r[RAW.store] ?? "").trim() !== YEOGI_STORE) o.allYeogi = false;
    o.logisticsSum += num(r[RAW.logistics]);
    o.feeSum += num(r[RAW.deliveryFee]);
    orders.set(oid, o);
  }
  for (const o of orders.values()) {
    // 본품 = 「⭐옵션매핑」에서 「메인」으로 지정된 줄, 없으면 매출이 가장 큰 줄
    const live = o.rows.filter((r) => !isCanceled(String(r[RAW.status] ?? "")));
    const pool = live.length > 0 ? live : o.rows;
    const typeOf = (r: string[]) => {
      const ch = String(r[RAW.channelNo] ?? "").trim();
      const code = String(r[RAW.optionCode] ?? "").trim();
      return optMap.get(code ? `${ch}|${code}` : ch)?.type ?? "";
    };
    const tagged = pool.find((r) => typeOf(r) === "메인");
    if (tagged) {
      o.mainKey = String(tagged[RAW.productOrderId] ?? "");
    } else {
      const notAdd = pool.filter((r) => typeOf(r) !== "추가");
      const cand = notAdd.length > 0 ? notAdd : pool;
      const best = [...cand].sort((a, b) => num(b[RAW.sales]) - num(a[RAW.sales]))[0];
      o.mainKey = String(best?.[RAW.productOrderId] ?? "");
    }
  }

  // ── 배송비 이상(③) 판정용.
  //    배송비는 «줄»이 아니라 «주문» 단위로 붙는다 (묶음배송이면 주문의 한 줄에만 실린다).
  //    그래서 줄 단위로 0 원을 비교하면 묶음배송 뒷줄이 전부 거짓 경보가 된다.
  //    → 주문 전체 배송비 합을 그 주문의 «대표 줄 옵션» 에 귀속시켜 옵션끼리 비교한다.
  const feeByOption = new Map<string, { zero: Set<string>; paid: Set<string> }>();
  const feeKeyOfOrder = new Map<string, string>();
  for (const [oid, o] of orders) {
    if (o.hasCanceled) continue; // 취소 주문은 배송비가 공란으로 저장돼 비교 대상이 아님
    const main = o.rows.find((r) => String(r[RAW.productOrderId] ?? "") === o.mainKey) ?? o.rows[0];
    const key = `${String(main[RAW.channelNo] ?? "").trim()}|${String(main[RAW.optionCode] ?? "").trim()}`;
    feeKeyOfOrder.set(oid, key);
    const bucket = feeByOption.get(key) ?? { zero: new Set<string>(), paid: new Set<string>() };
    if (o.feeSum > 0) bucket.paid.add(oid);
    else bucket.zero.add(oid);
    feeByOption.set(key, bucket);
  }

  // ── 줄별 검사 ──
  const work: WorkRow[] = [];
  const byType: Record<string, number> = {};
  const byTypeInfo: Record<string, number> = {};
  const samples: VerifyFlagSample[] = [];
  const sampleCount: Record<string, number> = {};
  const addFlag = (
    w: WorkRow, type: string, detail: string, info = false,
  ) => {
    const text = info ? `${INFO_MARK} ${type}: ${detail}` : `${type}: ${detail}`;
    (info ? w.infoFlags : w.flags).push(text);
    const bucket = info ? byTypeInfo : byType;
    bucket[type] = (bucket[type] ?? 0) + 1;
    if ((sampleCount[type] ?? 0) < 3) {
      sampleCount[type] = (sampleCount[type] ?? 0) + 1;
      samples.push({
        type, store: w.store, date: w.date, orderId: w.orderId,
        optionCode: w.optionCode, productName: w.productName,
        optionName: w.optionName, detail,
      });
    }
  };

  for (const r of inWindow) {
    if (isCanceled(String(r[RAW.status] ?? ""))) continue; // 취소건은 값이 비어 있어 검산 대상 아님
    const store = String(r[RAW.store] ?? "").trim();
    const channelNo = String(r[RAW.channelNo] ?? "").trim();
    const optionCode = String(r[RAW.optionCode] ?? "").trim();
    const productName = String(r[RAW.productName] ?? "");
    const optionName = String(r[RAW.option] ?? "");
    const orderId = String(r[RAW.orderId] ?? "").trim();
    const qty = num(r[RAW.qty]);
    const sales = num(r[RAW.sales]);
    const deliveryFee = num(r[RAW.deliveryFee]);
    const commission = num(r[RAW.commission]);
    const settlement = numOrNull(r[RAW.settlement]);
    const cost = numOrNull(r[RAW.cost]);
    const logistics = numOrNull(r[RAW.logistics]);
    const profit = numOrNull(r[RAW.profit]);
    const o = orders.get(orderId);
    const isMain = !o || o.mainKey === String(r[RAW.productOrderId] ?? "");

    const isYeogi = store === YEOGI_STORE || OPTMAP_EXCLUDED_STORES.has(store);
    const resolved: Resolved = isYeogi
      ? {
        text: "사입관리(여기명품)", source: "사입관리", unitCost: null,
        pickCost: null, autoCost: null, autoIsComposite: false, totalUnits: 0,
      }
      : resolveCost(productName, optionName, channelNo, optionCode, items, compRules, optMap);

    const w: WorkRow = {
      store, date: String(r[RAW.date] ?? "").slice(0, 10), orderId, optionCode, channelNo,
      productName: productName.slice(0, 60), optionName: optionName.slice(0, 80),
      kind: isMain ? "본품" : "추가",
      unitPrice: qty > 0 ? Math.round((sales - deliveryFee) / qty) : 0,
      qty, sales, commission, settlement,
      costText: resolved.text,
      cost, logistics, deliveryFee, profit,
      rate: profit != null && sales > 0 ? round1((profit / sales) * 100) : null,
      flags: [], infoFlags: [],
    };

    // ① 검산식: 정산 − 원가 − 물류 + 배송비 = 이익
    if (settlement != null && cost != null && profit != null) {
      const expect = settlement - cost - (logistics ?? 0) + deliveryFee;
      if (Math.abs(expect - profit) > 1) {
        addFlag(w, FLAG.formula, `계산 ${won(expect)} ≠ 저장 ${won(profit)} (차 ${won(expect - profit)})`);
      }
    }

    // ② 드롭다운 값 ↔ 자동해석 값 불일치 (의도적 차이일 수 있어 「확인 요망」 수준)
    //    지난 「대표 줄 드롭다운 5,200」 사고를 잡았을 조건.
    //
    //    ⚠️ 자동해석이 «복합»(피쿠알2+블렌딩1)인 경우는 제외한다.
    //    드롭다운 한 칸으로는 복합 구성을 표현할 수 없어 시스템이 일부러 드롭다운을 무시하고
    //    자동해석을 쓴다 — 설계대로 동작한 것이라 경보가 아니다.
    //    (이걸 안 걸렀더니 7일치 445줄 중 111줄이 전부 이 사유로 노랗게 떠서 정작 볼 줄이 묻혔다)
    if (!isYeogi && resolved.source !== "수동" && !resolved.autoIsComposite
      && resolved.pickCost != null && resolved.autoCost != null
      && resolved.pickCost !== resolved.autoCost) {
      addFlag(
        w, FLAG.pickVsAuto,
        `드롭다운 ${won(resolved.pickCost)} vs 자동 ${won(resolved.autoCost)} → 적용 ${resolved.source} ${won(resolved.unitCost ?? 0)} (확인 요망)`,
      );
    }

    // ②-b 옵션에 「3박스」·「2세트」 같은 수량이 적혀 있는데 원가는 1개 기준으로 잡힌 경우.
    //     ②와 달리 자동해석이 아예 실패했을 때도 잡힌다 (「3박스(42포)」가 그랬다).
    //     ⚠️ 상품명은 절대 보지 않는다 — 「…올리브오일 3병 피쿠알…」처럼 마케팅 문구에 병수가
    //     박혀 있어서, 실제로는 1병 옵션인 줄까지 전부 오탐으로 뜬다(실측 5건).
    if (!isYeogi && cost != null && cost > 0 && resolved.totalUnits === 1) {
      const token = explicitQtyToken(optionName);
      if (token) {
        addFlag(
          w, FLAG.qtyIgnored,
          `옵션에 「${token}」 표기 — 원가는 1개 기준(${resolved.text})으로 계산됨`,
        );
      }
    }

    // ③ 배송비 이상 — 같은 옵션인데 어떤 주문은 배송비 있고 어떤 주문은 0
    //    주문의 대표 줄에만 표시한다 (한 주문에 여러 줄이 있어도 경보는 한 번).
    const feeKey = feeKeyOfOrder.get(orderId);
    const feeBucket = feeKey ? feeByOption.get(feeKey) : undefined;
    if (feeBucket && isMain && feeBucket.zero.size > 0 && feeBucket.paid.size > 0) {
      const orderPaid = (o?.feeSum ?? 0) > 0;
      const minorityIsZero = feeBucket.zero.size <= feeBucket.paid.size;
      if (orderPaid !== minorityIsZero) {
        addFlag(
          w, FLAG.delivery,
          `같은 옵션 주문 ${feeBucket.paid.size}건은 배송비 있고 ${feeBucket.zero.size}건은 0 — 이 주문 ${won(o?.feeSum ?? 0)}`,
        );
      }
    }

    // ④ 이익률 이상치
    if (w.rate != null) {
      if (w.rate < 0) addFlag(w, FLAG.rate, `역마진 ${w.rate}%`);
      else if (w.rate > PROFIT_RATE_MAX) addFlag(w, FLAG.rate, `${w.rate}% (원가 과소 의심)`);
    }

    // ⑤ 원가 0/미해석인데 이익이 잡힘 / 매출 < 정산
    if (!isYeogi && cost != null && cost <= 0 && profit != null && sales > 0) {
      addFlag(w, FLAG.zeroCost, `원가 0 · ${resolved.text}`);
    }
    if (settlement != null && sales > 0 && settlement > sales) {
      addFlag(w, FLAG.coupon, `매출 ${won(sales)} < 정산 ${won(settlement)}`, true);
    }

    // ⑥ 묶음배송 물류비 — 주문당 정확히 1회
    //    취소가 섞인 주문은 취소 줄의 물류비가 공란으로 저장돼 합계가 어긋나므로 제외.
    //    여기명품은 사입가에 물류비가 포함돼 0 이 정상이지만, 사입 입력 전에는 4,500 이
    //    잡혀 있다(원가 자체가 「설정 필요」). 둘 다 정상 범위로 보고 «2회 이상»만 잡는다.
    if (o && !o.hasCanceled && isMain) {
      const allowed = o.allYeogi ? [0, settings.logisticsPerShipment] : [settings.logisticsPerShipment];
      if (!allowed.includes(o.logisticsSum)) {
        const times = settings.logisticsPerShipment > 0
          ? round1(o.logisticsSum / settings.logisticsPerShipment) : 0;
        addFlag(
          w, FLAG.logistics,
          `주문 합계 ${won(o.logisticsSum)} (기대 ${allowed.map(won).join(" 또는 ")}, ${times}회) · ${o.rows.length}줄 주문`,
        );
      }
    }

    work.push(w);
  }

  // ── 정렬: 확인 필요 → 정보성 → 정상, 각 그룹 안에서는 최근 날짜 먼저 ──
  const grade = (w: WorkRow) => (w.flags.length > 0 ? 0 : w.infoFlags.length > 0 ? 1 : 2);
  work.sort((a, b) =>
    grade(a) - grade(b)
    || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
    || (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0));

  const out: (string | number)[][] = work.map((w) => [
    w.store, w.date, w.orderId, w.optionCode, w.productName, w.optionName,
    w.kind, w.unitPrice, w.qty, w.sales, w.commission,
    w.settlement ?? SETUP_NEEDED,
    w.costText,
    w.cost ?? SETUP_NEEDED,
    w.logistics ?? 0,
    w.deliveryFee,
    w.profit ?? SETUP_NEEDED,
    w.rate ?? "",
    [...w.flags, ...w.infoFlags].join(" / "),
  ]);

  // ── 추가상품 전수 목록 ──
  const addonMap = new Map<string, {
    name: string; optionCode: string; channelNo: string;
    qty: number; sales: number; deliveryFee: number;
    profit: number; profitKnown: boolean; costSum: number; costKnown: boolean;
  }>();
  for (const w of work) {
    if (w.kind !== "추가") continue;
    const key = `${w.channelNo}|${w.optionCode}|${w.optionName}`;
    const a = addonMap.get(key) ?? {
      name: (w.optionName || w.productName).slice(0, 50),
      optionCode: w.optionCode, channelNo: w.channelNo,
      qty: 0, sales: 0, deliveryFee: 0, profit: 0, profitKnown: true, costSum: 0, costKnown: true,
    };
    a.qty += w.qty;
    a.sales += w.sales;
    a.deliveryFee += w.deliveryFee;
    if (w.profit == null) a.profitKnown = false; else a.profit += w.profit;
    if (w.cost == null) a.costKnown = false; else a.costSum += w.cost;
    addonMap.set(key, a);
  }
  const addons: AddonSummaryRow[] = [...addonMap.values()]
    .sort((x, y) => y.sales - x.sales)
    .map((a) => ({
      name: a.name,
      optionCode: a.optionCode,
      channelNo: a.channelNo,
      avgPrice: a.qty > 0 ? Math.round((a.sales - a.deliveryFee) / a.qty) : 0,
      unitCost: a.costKnown && a.qty > 0 ? Math.round(a.costSum / a.qty) : null,
      qty: a.qty,
      sales: a.sales,
      profit: a.profitKnown ? a.profit : null,
      rate: a.profitKnown && a.sales > 0 ? round1((a.profit / a.sales) * 100) : null,
    }));

  // ── 시트 반영 ──
  await ensureTab(c, VERIFY_TAB, VERIFY_HEADERS);
  const lastCol = colLetter(VERIFY_HEADERS.length - 1);            // S
  const addonFirst = colLetter(ADDON_START_COL);                   // U
  const addonLast = colLetter(ADDON_START_COL + ADDON_HEADERS.length - 1); // AC
  await clearRange(c, `${VERIFY_TAB}!A2:${lastCol}100000`);
  await clearRange(c, `${VERIFY_TAB}!${addonFirst}1:${addonLast}100000`);
  if (out.length > 0) {
    await writeRange(c, `${VERIFY_TAB}!A2:${lastCol}${out.length + 1}`, out);
  }
  const addonRows: (string | number)[][] = [
    ADDON_HEADERS,
    ...addons.map((a) => [
      a.name, a.optionCode, a.channelNo, a.avgPrice,
      a.unitCost ?? SETUP_NEEDED, a.qty, a.sales,
      a.profit ?? SETUP_NEEDED, a.rate ?? "",
    ]),
  ];
  await writeRange(
    c, `${VERIFY_TAB}!${addonFirst}1:${addonLast}${addonRows.length}`, addonRows,
  );

  // 보기 좋게 — 부가 설정 실패는 삼킨다 (검산 결과 자체는 이미 들어갔다)
  try {
    await setHeaderNotes(c, VERIFY_TAB, VERIFY_NOTES);
    await setFrozenRows(c, VERIFY_TAB, 1);
    await setColumnWidths(c, VERIFY_TAB, [
      { i: 0, px: 90 }, { i: 1, px: 90 }, { i: 2, px: 120 }, { i: 3, px: 110 },
      { i: 4, px: 220 }, { i: 5, px: 240 }, { i: 6, px: 55 }, { i: 7, px: 85 },
      { i: 8, px: 50 }, { i: 9, px: 90 }, { i: 10, px: 85 }, { i: 11, px: 90 },
      { i: 12, px: 230 }, { i: 13, px: 85 }, { i: 14, px: 90 }, { i: 15, px: 90 },
      { i: 16, px: 90 }, { i: 17, px: 70 }, { i: 18, px: 420 },
      { i: ADDON_START_COL, px: 240 },
    ].map((x) => ({ index: x.i, px: x.px })));
    // 확인 필요 = 노란색 / 정보성 = 옅은 파랑
    await applyRowFormatRule(
      c, VERIFY_TAB,
      `=AND($${lastCol}2<>"",LEFT($${lastCol}2,1)<>"${INFO_MARK}")`,
      VERIFY_HEADERS.length,
      { backgroundColor: { red: 1, green: 0.95, blue: 0.7 } },
    );
    await applyRowFormatRule(
      c, VERIFY_TAB,
      `=LEFT($${lastCol}2,1)="${INFO_MARK}"`,
      VERIFY_HEADERS.length,
      { backgroundColor: { red: 0.87, green: 0.93, blue: 1 } },
    );
  } catch (err) {
    console.warn(`[검산] 서식 적용 실패(무시): ${err instanceof Error ? err.message : err}`);
  }

  let link = "";
  try {
    const gid = (await getSheetIdMap(c)).get(VERIFY_TAB);
    if (gid != null) link = `https://docs.google.com/spreadsheets/d/${c.sheetId}/edit#gid=${gid}`;
  } catch { /* 링크 없어도 무방 */ }

  const flagged = work.filter((w) => w.flags.length > 0).length;
  const infoOnly = work.filter((w) => w.flags.length === 0 && w.infoFlags.length > 0).length;
  console.log(
    `✅ 「${VERIFY_TAB}」 ${win.from}~${win.to}: ${work.length}줄 검사 / 확인필요 ${flagged}줄 / 정보성 ${infoOnly}줄 / 추가상품 ${addons.length}종`,
  );
  for (const [t, n] of Object.entries(byType)) console.log(`   · ${t}: ${n}건`);
  for (const [t, n] of Object.entries(byTypeInfo)) console.log(`   · (정보) ${t}: ${n}건`);

  return { rows: work.length, flagged, infoOnly, byType, byTypeInfo, samples, addons, link, window: win };
}

/**
 * 아침 보고에 한 줄로 붙일 요약.
 * 텔레그램은 parse_mode=HTML 이라 「<」·「&」 가 있으면 메시지가 깨지므로 escape 한다.
 */
export function verifySummaryLine(v: VerifyResult): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (v.flagged === 0) return "🔎 ✅ 검산 이상 없음";
  const top = Object.entries(v.byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => `${esc(t)} ${n}`)
    .join(", ");
  return `🔎 ⚠️ 검산 플래그 ${v.flagged}건 — 시트 확인 (${top})`;
}

// CLI 로 직접 실행했을 때만 (run.ts 가 import 할 때는 안 돎)
if (process.argv[1] && /verify\.ts$/.test(process.argv[1])) {
  const creds = loadCredsFromEnv();
  if (!creds) throw new Error("시트 자격증명 없음");
  const yesterday = new Date(Date.now() + 9 * 3600 * 1000 - 24 * 3600 * 1000)
    .toISOString().slice(0, 10);
  const endDate = process.argv[2] ?? yesterday;
  const days = Number(process.argv[3] ?? 7) || 7;
  (async () => {
    const v = await updateVerifyTab(creds, endDate, days);
    console.log("\n" + verifySummaryLine(v));
    if (v.samples.length > 0) {
      console.log("\n=== 대표 사례 ===");
      for (const s of v.samples) {
        console.log(`[${s.type}] ${s.date} ${s.store} ${s.productName.slice(0, 24)} / ${s.optionName.slice(0, 34)}`);
        console.log(`   주문 ${s.orderId} · 옵션 ${s.optionCode || "(없음)"} → ${s.detail}`);
      }
    }
    if (v.addons.length > 0) {
      console.log("\n=== 추가상품 ===");
      for (const a of v.addons.slice(0, 15)) {
        console.log(
          `${a.name.slice(0, 30)} | 판매가 ${won(a.avgPrice)} | 원가 ${a.unitCost == null ? SETUP_NEEDED : won(a.unitCost)}`
          + ` | ${a.qty}개 | 매출 ${won(a.sales)} | 이익률 ${a.rate == null ? "-" : a.rate + "%"}`,
        );
      }
    }
    if (v.link) console.log(`\n📄 ${v.link}`);
  })().catch((err) => {
    console.error("FATAL:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
