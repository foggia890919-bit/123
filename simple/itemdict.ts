/**
 * 「품목사전」 + 옵션 구성 자동 해석.
 *
 * 왜: 옵션 줄마다 원가를 적는 구조는 원가가 바뀔 때 수십 줄을 전부 고쳐야 해서 관리가 안 된다.
 *     실물 품목(피쿠알·블렌딩·레몬즙…) 단위로 원가를 한 곳에 두고,
 *     판매 옵션 텍스트를 «품목 × 병수» 로 분해해 원가를 계산한다.
 *     → 원가가 바뀌면 「품목사전」 한 칸만 고치면 끝.
 *
 * 탭 2개:
 *   「품목사전」   A 품목명 | B 개당원가 | C 별칭(쉼표구분) | D 메모
 *   「구성해석」   A 상품명 | B 옵션 | C 자동해석 | D 수동구성 | E 상태 | F 건수
 *                 D 에 `피쿠알2+블렌딩1` 처럼 적으면 그게 최우선.
 */

import { ensureTab, readRange, upsertRows, setHeaderNotes, type SheetCreds } from "./sheets";

export const ITEM_TAB = "품목사전";
export const ITEM_HEADERS = ["품목명", "개당원가", "별칭(쉼표구분)", "메모"];
export const ITEM_NOTES = [
  "실물 품목 이름. 옵션 텍스트에서 이 이름을 찾아 원가를 매깁니다.\n예: 피쿠알, 블렌딩, 레몬즙, 종아리형",
  "★사장님 입력★ 이 품목 1개(1병)당 매입원가. 숫자만.\n원가가 바뀌면 여기 한 칸만 고치면 전 상품에 반영됩니다.",
  "옵션에 다른 이름으로 적히는 경우 쉼표로 나열.\n예: 오메가3 → 알티지,프로메가",
  "자유 메모. 계산에 쓰이지 않습니다.",
];

export const COMP_TAB = "구성해석";
export const COMP_HEADERS = ["상품번호", "상품명", "옵션", "자동해석", "수동구성", "상태", "건수"];
export const COMP_NOTES = [
  "네이버 상품번호 (자동). 이 번호 + 옵션으로 한 줄이 정해집니다.",
  "네이버 상품명 (자동)",
  "네이버 옵션 텍스트 (자동)",
  "시스템이 해석한 구성 (자동). 비어 있으면 해석 실패.",
  "★사장님 입력★ 자동해석이 없거나 틀렸을 때만 적으세요.\n문법: 품목명+숫자 를 + 로 연결\n예: 피쿠알2+블렌딩1  /  종아리형2\n여기 적으면 자동해석보다 우선합니다.",
  "OK = 해석됨 / 수동 = 사장님이 지정 / 구성 정의 필요 = 손봐야 함",
  "이 옵션으로 팔린 주문 줄 수 (자동)",
];

export const NEEDS_COMP = "구성 정의 필요";

export interface Item {
  name: string;
  cost: number;      // 0 = 미입력
  aliases: string[];
}
export interface CompPart {
  item: string;
  qty: number;
}

// ── 품목사전 로드 ──
export async function loadItems(c: SheetCreds): Promise<Item[]> {
  await ensureTab(c, ITEM_TAB, ITEM_HEADERS);
  try {
    await setHeaderNotes(c, ITEM_TAB, ITEM_NOTES);
  } catch { /* 노트 실패는 무시 */ }
  const rows = await readRange(c, `${ITEM_TAB}!A2:D1000`);
  const items: Item[] = [];
  for (const r of rows) {
    const name = String(r[0] ?? "").trim();
    if (!name) continue;
    items.push({
      name,
      cost: Number(String(r[1] ?? "").replace(/,/g, "")) || 0,
      aliases: String(r[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    });
  }
  return items;
}

// ── 구성 해석 ──

/** "사이즈: M" → "M" (콜론 앞 라벨 제거) */
function stripKey(s: string): string {
  const i = s.indexOf(":");
  return i >= 0 ? s.slice(i + 1).trim() : s.trim();
}

/** 품목명/별칭 → 품목명. 긴 것부터 매칭해 "아보카도오일"이 "아보카도"에 먹히지 않게 한다. */
function needles(items: Item[]): { needle: string; item: string }[] {
  const out: { needle: string; item: string }[] = [];
  for (const it of items) {
    out.push({ needle: it.name, item: it.name });
    for (const a of it.aliases) out.push({ needle: a, item: it.name });
  }
  return out.sort((a, b) => b.needle.length - a.needle.length);
}

/**
 * 품목 바로 뒤 문자열에서 수량을 읽는다.
 * @returns [수량, 명시여부] — 명시여부 false 면 "그냥 1개로 봤다"는 뜻
 *
 * 규칙 (순서대로):
 *   1. "1+1", "2 + 1"      → 합계 (증정 포함 총 병수)
 *   2. "2병", "3 개"        → 그 숫자
 *   3. 붙어 있는 1~2자리 숫자 뒤가 +/공백/)/끝  → 그 숫자   ("블렌딩1+피쿠알1")
 * "피쿠알 250ml" 처럼 스펙 숫자는 걸러야 하므로 3번은 반드시 **붙어 있고 2자리 이하**여야 한다.
 */
function readQty(after: string): [number, boolean] {
  let m = after.match(/^\s*(\d{1,2})\s*\+\s*(\d{1,2})/);
  if (m) return [parseInt(m[1], 10) + parseInt(m[2], 10), true];
  m = after.match(/^\s*(\d{1,2})\s*(?:병|개|팩|박스)/);
  if (m) return [parseInt(m[1], 10), true];
  m = after.match(/^(\d{1,2})(?=[+\s)\]]|$)/);
  if (m) return [parseInt(m[1], 10), true];
  return [1, false];
}

/** "3병", "2+1병", "1박스" 처럼 세그먼트 전체가 수량인 경우 → 총 개수 */
function readTrailingQty(seg: string): number | null {
  const m = seg.match(/^(\d{1,2})(?:\s*\+\s*(\d{1,2}))?\s*(?:병|개|팩|박스)/);
  if (!m) return null;
  return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0);
}

/**
 * 옵션(+상품명) 텍스트를 품목 구성으로 분해.
 * @returns 구성 배열, 또는 null (해석 실패/모호 — 사람이 정해야 함)
 */
export function parseComposition(
  productName: string,
  optionText: string,
  items: Item[],
): CompPart[] | null {
  const ns = needles(items);

  // 옵션이 비어 있는 경우.
  // 원칙: 상품명은 마케팅 문구라 구성을 추론하지 않는다 (그럴듯하지만 틀린 원가가 나옴).
  // 예외: 네이버 낱개 상품은 상품명이 "…피쿠알 250ml, 8개" 처럼 **끝에 ", N개/N병"** 으로
  //       수량이 붙는 정형 패턴이다. 이건 마케팅 문구가 아니라 규격이라 신뢰할 수 있다.
  //       단 품목이 딱 하나로 특정될 때만 (여러 품목이 섞이면 어느 게 N개인지 알 수 없다).
  if (!optionText || !optionText.trim()) {
    const m = productName.match(/,\s*(\d{1,2})\s*(?:개|병)\s*$/);
    if (!m) return null;
    const qty = parseInt(m[1], 10);
    const hits = new Set<string>();
    let masked = productName;
    for (const { needle, item } of ns) {
      const idx = masked.indexOf(needle);
      if (idx >= 0) {
        hits.add(item);
        masked = masked.slice(0, idx) + " ".repeat(needle.length) + masked.slice(idx + needle.length);
      }
    }
    if (hits.size !== 1) return null;
    return [{ item: [...hits][0], qty }];
  }

  const rawSegs = optionText.split("/");

  const found: { item: string; qty: number; explicit: boolean }[] = [];
  let trailing: number | null = null;

  for (const rawSeg of rawSegs) {
    // 수량은 "키: 값" 의 값 쪽에서 읽고 (예: "담을수록…: 3병" → 3),
    // 품목명은 **자르지 않은 원문**에서 찾는다. "윈트큐민 90정: 1박스" 처럼
    // 품목명이 콜론 앞에 오는 경우가 많아 잘라내면 못 찾는다.
    const t = readTrailingQty(stripKey(rawSeg));
    if (t != null && trailing == null) trailing = t;

    // 이미 잡은 구간을 다시 잡지 않도록 마스킹하면서 스캔
    let masked = rawSeg;
    for (const { needle, item } of ns) {
      let idx = masked.indexOf(needle);
      while (idx >= 0) {
        // 낱말 중간에서 끊긴 매칭 보정 —
        // 별칭 「종아리」가 「종아리형 1+1」 안에서 잡히면 뒤가 "형 1+1" 로 남아
        // 수량(1+1=2)을 못 읽고 1개로 세어 원가가 절반이 된다.
        // 매칭 뒤에 이어지는 한글은 같은 낱말의 꼬리로 보고 함께 건너뛴 다음 수량을 읽는다.
        const tailLen = (masked.slice(idx + needle.length).match(/^[가-힣]{1,3}/) ?? [""])[0].length;
        const after = masked.slice(idx + needle.length + tailLen);
        // "레몬즙1포증정" 같은 증정품은 원가 계산에서 제외 (한 포는 한 팩이 아니라 과대계상됨).
        // 창을 좁게 잡는다 — 넓히면 "아보카도오일(+레몬즙1포증정" 에서 앞의 본품까지 증정으로 오인한다.
        if (/^\s*\d{0,2}\s*[가-힣]{0,2}\s*증정/.test(after)) {
          masked = masked.slice(0, idx) + " ".repeat(needle.length) + masked.slice(idx + needle.length);
          idx = masked.indexOf(needle);
          continue;
        }
        const [qty, explicit] = readQty(after);
        found.push({ item, qty, explicit });
        masked = masked.slice(0, idx) + " ".repeat(needle.length) + masked.slice(idx + needle.length);
        idx = masked.indexOf(needle);
      }
    }
  }

  if (found.length === 0) return null;

  const hasExplicit = found.some((f) => f.explicit);
  const distinct = new Set(found.map((f) => f.item));

  let parts: CompPart[];
  if (hasExplicit) {
    // 품목마다 숫자가 붙어 있으면 그대로 신뢰 (예: 피쿠알2병+아르베키나1병)
    //
    // 단, **같은 품목이 여러 번 걸렸는데 그중 하나에만 수량이 명시**돼 있으면
    // 나머지는 «같은 물건을 가리키는 다른 표현»(마케팅 접두어·별칭)이지 추가 수량이 아니다.
    //   "올레샷! 레몬즙 특가!: 유기농 NFC착즙 레몬즙 1팩(14포)"
    //     → 접두어 「레몬즙」 + 별칭 「NFC착즙 레몬즙」 + 이름 「레몬즙」 = 3개로 세어
    //       원가가 3,400 이 아니라 10,200 으로 잡혔다 (171행이 이 상태였다).
    // 수량이 명시된 품목은 «명시된 것만» 센다. 다른 품목의 암묵 1개는 그대로 둔다
    // (예: "피쿠알2병+레몬즙" 은 피쿠알2 + 레몬즙1 이 맞다).
    const explicitItems = new Set(found.filter((f) => f.explicit).map((f) => f.item));
    parts = found
      .filter((f) => f.explicit || !explicitItems.has(f.item))
      .map((f) => ({ item: f.item, qty: f.qty }));
  } else if (distinct.size === 1) {
    // 품목 하나 + 뒤에 총 수량 (예: 피쿠알 250ml / 3병)
    parts = [{ item: [...distinct][0], qty: trailing ?? 1 }];
  } else if (trailing == null || trailing === 1) {
    // 품목 여러 개인데 수량 표기가 없음 → 각 1개 (예: 종아리형+무릎형)
    parts = [...distinct].map((item) => ({ item, qty: 1 }));
  } else {
    // 품목 여러 개인데 총 수량만 있음 → 어느 품목이 몇 개인지 알 수 없음. 사람이 정해야 함.
    return null;
  }

  // 같은 품목 합치기
  const merged = new Map<string, number>();
  for (const p of parts) merged.set(p.item, (merged.get(p.item) ?? 0) + p.qty);
  return [...merged.entries()].map(([item, qty]) => ({ item, qty }));
}

/** `피쿠알2+블렌딩1` → [{피쿠알,2},{블렌딩,1}]. 숫자 없으면 1. 못 읽으면 null. */
export function parseManualComposition(text: string, items: Item[]): CompPart[] | null {
  const s = String(text ?? "").trim();
  if (!s) return null;
  const names = new Set(items.map((i) => i.name));
  const parts: CompPart[] = [];
  for (const chunk of s.split("+")) {
    const m = chunk.trim().match(/^(.+?)\s*(\d{1,2})?$/);
    if (!m) return null;
    const name = m[1].trim();
    if (!names.has(name)) return null;
    parts.push({ item: name, qty: m[2] ? parseInt(m[2], 10) : 1 });
  }
  return parts.length > 0 ? parts : null;
}

export const formatComposition = (parts: CompPart[]): string =>
  parts.map((p) => `${p.item}${p.qty}`).join("+");

/** 검수 화면 표기 — "아보카도오일×3", 복합이면 "피쿠알×2+블렌딩×1" */
export const formatCompositionUi = (parts: CompPart[]): string =>
  parts.map((p) => `${p.item}×${p.qty}`).join("+");

/**
 * 라벨에서 병(개) 수 추출. "…기름, 3병" → 3, 없으면 1
 *
 * ⚠️ 「포」는 절대 단위 목록에 넣지 말 것 — 「3박스(42포)」·「1팩(14포)」에서 42·14 를
 *    잡으면 원가가 14배가 된다. 「포」를 안 세면 앞의 「3박스」·「1팩」이 먼저 잡혀 정답이 된다.
 * ⚠️ 괄호를 지우는 방식도 쓰면 안 된다 — 「수량: 24500원(3병)」처럼 **수량이 괄호 안에
 *    들어 있는 옵션이 훨씬 많다**. 실제로 괄호를 지웠더니 아보카도오일 19개 조합이
 *    ×3 → ×1 로 깎여 원가가 105만원 사라졌다.
 * ⚠️ 「박스」는 「압박스타킹」 안에도 들어 있지만 숫자가 바로 앞에 와야 매칭되므로
 *    (「압박스타킹」에는 숫자가 없다) 오탐이 나지 않는다. 실데이터 전 기간으로 확인함.
 */
export function bottlesOfLabel(label: string): number {
  const m = String(label ?? "").match(/(\d+)\s*(?:병|개|입|박스|set|세트|팩)/i);
  return m ? parseInt(m[1], 10) : 1;
}

/**
 * 파서가 모르는 품목의 «이름 후보» 뽑기.
 *
 * 사장님이 품목사전에 줄을 직접 만들게 하지 않고, 시스템이 빈 줄을 만들어 두고
 * 원가만 받기 위한 것. 핵심은 **옵션·상품명에 실제로 등장하는 토큰**을 뽑는 것 —
 * 그래야 사장님이 원가를 넣는 순간 자동 해석이 바로 걸린다.
 */
const GENERIC_KEYS = new Set([
  "옵션명", "옵션", "선택 옵션", "선택옵션", "수량", "사이즈", "색상", "컬러",
  "모델명", "상품명", "타입", "종류", "구성", "용량", "맛", "추가",
]);

/**
 * 품목 «이름» 이 될 수 없는 마케팅 수식어. 상품명 첫 낱말을 후보로 뽑을 때 걸러낸다.
 *
 * ⚠️ 이걸 안 걸렀다가 사고가 났다. 상품명 "유기농 올리브앤토마토 샷…" 의 첫 낱말인
 *    「유기농」이 품목으로 자동 등록됐고(원가 공란), 그 순간 "최고급 **유기농** 올리브오일:
 *    아르베키나 / …: 3병" 같은 옵션이 «아르베키나 + 유기농» 2품목으로 해석돼
 *    「여러 품목인데 총 수량만 있음」 = 해석 불가가 되면서 4,000행 가까이가 한꺼번에
 *    원가 미확정으로 떨어졌다. 수식어는 거의 모든 상품명에 들어가므로 파급이 크다.
 */
const GENERIC_WORDS = new Set([
  "유기농", "무농약", "친환경", "최고급", "고급", "프리미엄", "특가", "할인", "행사",
  "정품", "국내산", "수입산", "신상", "인기", "베스트", "한정", "무료배송", "당일발송",
  "엑스트라버진", "냉압착", "대용량", "선물세트", "선물", "세트",
]);

/** 텍스트에 이미 아는 품목이 하나라도 등장하는가. */
export function hasKnownItem(productName: string, optionText: string, items: Item[]): boolean {
  const text = `${productName} ${optionText}`;
  return needles(items).some(({ needle }) => needle && text.includes(needle));
}

/**
 * @returns 품목 이름 후보. 이미 아는 품목이 등장하는 텍스트면 null —
 *          그건 «모르는 품목» 이 아니라 «구성이 애매한» 경우라서
 *          (예: "피쿠알 250ml+레몬즙본품 / 3병") 품목을 새로 만들면 사전만 더러워진다.
 */
export function guessItemName(productName: string, optionText: string, items?: Item[]): string | null {
  if (items && hasKnownItem(productName, optionText, items)) return null;
  // 1순위: "키: 값" 의 키 — "알부민: 코오롱 실크 알부민(30병)" 의 「알부민」처럼
  //        품목 이름이 그대로 오는 경우가 많다.
  const firstSeg = String(optionText ?? "").split("/")[0] ?? "";
  const ci = firstSeg.indexOf(":");
  if (ci > 0) {
    const key = firstSeg.slice(0, ci).trim();
    if (key && !GENERIC_KEYS.has(key) && key.length >= 2 && key.length <= 12 && /[가-힣A-Za-z]/.test(key)) {
      return key;
    }
  }
  // 2순위: 상품명 첫 낱말 (브랜드·제품명이 앞에 오는 네이버 관행)
  //        단 마케팅 수식어(유기농·최고급…)는 건너뛴다 — 품목이 아니라 꾸밈말이고,
  //        품목으로 등록되면 거의 모든 옵션에 걸려 해석을 통째로 망가뜨린다.
  const token = String(productName ?? "")
    .replace(/^\[[^\]]*\]\s*/, "") // "[당일발송] " 같은 머리표 제거
    .split(/[\s,(]/)
    .map((t) => t.trim())
    .find((t) => t.length >= 2 && t.length <= 12 && /[가-힣]/.test(t) && !GENERIC_WORDS.has(t));
  return token || null;
}

/**
 * 품목사전에 없는 품목을 «원가 공란» 으로 자동 등록.
 * 이미 있는 이름은 건너뛴다(중복 생성 방지). 원가는 절대 채우지 않는다 — 사장님 몫.
 */
export async function addPlaceholderItems(
  c: SheetCreds,
  names: string[],
  items: Item[],
): Promise<string[]> {
  const known = new Set(items.map((i) => i.name));
  const toAdd = [...new Set(names)].filter((n) => n && !known.has(n));
  if (toAdd.length === 0) return [];
  await ensureTab(c, ITEM_TAB, ITEM_HEADERS);
  await upsertRows(
    c,
    ITEM_TAB,
    toAdd.map((n) => [n, "", "", "원가를 넣어주세요 (자동 추가)"]),
    (r) => String(r[0] ?? ""),
  );
  return toAdd;
}

/**
 * 「⭐옵션매핑」 라벨 한 줄을 구성으로 해석 (검수 화면 전용).
 *
 * 라벨은 판매 옵션 텍스트가 아니라 매핑용 이름(대개 상품명)이라 그대로 파싱하면
 * "…먹는법 기름, 3병" 이 «아보카도오일×1» 로 나온다. 실제 계산은 주문의 옵션 텍스트
 * ("…아보카도오일250ml: 3병")를 쓰므로 ×3 인데, 검수 화면만 ×1 로 보여 사장님이
 * 원가가 틀린 줄 알게 된다. 그래서 **라벨에 적힌 병수를 반영**해 표시를 계산과 맞춘다.
 *
 * 이미 수량이 명시된 복합 라벨("피쿠알2병+아르베키나1병" → 합계 3)은 병수를 다시 곱하면
 * 이중 계산이 되므로, **해석 결과 총 수량이 1일 때만** 병수로 확장한다.
 */
export function resolveLabelComposition(label: string, items: Item[]): CompPart[] | null {
  const parts = parseComposition("", label, items);
  if (!parts) return null;
  const total = parts.reduce((s, p) => s + p.qty, 0);
  const bottles = bottlesOfLabel(label);
  if (total === 1 && bottles > 1) {
    return [{ item: parts[0].item, qty: bottles }];
  }
  return parts;
}

/**
 * 구성 → 원가. 품목사전에 원가가 없는 품목이 하나라도 있으면 missing.
 */
export function costOfComposition(
  parts: CompPart[],
  items: Item[],
): { cost: number; missing: boolean } {
  const byName = new Map(items.map((i) => [i.name, i]));
  let cost = 0;
  let missing = false;
  for (const p of parts) {
    const it = byName.get(p.item);
    if (!it || it.cost <= 0) { missing = true; continue; }
    cost += it.cost * p.qty;
  }
  return { cost, missing };
}

// ── 「구성해석」 탭 ──
export interface CompRule {
  manual: CompPart[] | null;
  manualRaw: string;
}

/** 「구성해석」 로드 → key `상품명|옵션` → 수동 구성 */
export async function loadCompRules(
  c: SheetCreds,
  items: Item[],
): Promise<Map<string, CompRule>> {
  const map = new Map<string, CompRule>();
  await ensureTab(c, COMP_TAB, COMP_HEADERS);
  try {
    await setHeaderNotes(c, COMP_TAB, COMP_NOTES);
  } catch { /* 무시 */ }
  const rows = await readRange(c, `${COMP_TAB}!A2:G20000`);
  for (const r of rows) {
    const chNo = String(r[0] ?? "").trim();
    const opt = String(r[2] ?? "").trim();
    const manualRaw = String(r[4] ?? "").trim();
    if (!chNo) continue;
    map.set(compKey(chNo, opt), { manual: parseManualComposition(manualRaw, items), manualRaw });
  }
  return map;
}

/**
 * 구성해석 키 = 상품번호 + 옵션.
 * ⚠️ 상품명으로 키를 잡으면 안 된다 — "…냉압착 피쿠알 250ml, 8개" 처럼 **낱개 수량이 상품명 끝**에
 * 붙는 상품군은 앞부분이 전부 같아서, 1개들이~9개들이 9개 상품이 한 줄로 뭉개진다.
 * 그 줄에 구성을 하나 적으면 9개 팩까지 전부 1개 원가로 계산되는 사고가 난다.
 */
export const compKey = (channelProductNo: string, optionText: string) =>
  `${String(channelProductNo).trim()}|${String(optionText).trim()}`;

/**
 * 「구성해석」 탭 갱신 — 등장한 (상품명, 옵션) 조합을 모두 올리고 자동해석 결과를 채운다.
 * 사장님이 D열에 적은 수동 구성은 절대 덮어쓰지 않는다 (읽어서 그대로 다시 씀).
 */
export interface SeenOption {
  channelProductNo: string;
  optionManageCode?: string; // 알림에서 시트 찾기 쉽게
  productName: string;
  optionText: string;
  count: number;
}

export async function syncCompTab(
  c: SheetCreds,
  seen: SeenOption[],
  items: Item[],
  existing: Map<string, CompRule>,
): Promise<{ needManual: SeenOption[] }> {
  const rows: (string | number)[][] = [];
  const needManual: SeenOption[] = [];

  for (const s of seen) {
    const key = compKey(s.channelProductNo, s.optionText);
    const prev = existing.get(key);
    const auto = parseComposition(s.productName, s.optionText, items);
    const autoStr = auto ? formatComposition(auto) : "";
    const manualRaw = prev?.manualRaw ?? "";
    const status = prev?.manual ? "수동" : auto ? "OK" : NEEDS_COMP;
    if (status === NEEDS_COMP) needManual.push(s);
    rows.push([
      s.channelProductNo,
      String(s.productName).slice(0, 40),
      s.optionText,
      autoStr,
      manualRaw,
      status,
      s.count,
    ]);
  }

  if (rows.length > 0) {
    await upsertRows(c, COMP_TAB, rows, (r) => `${r[0]}|${r[2]}`);
  }
  return { needManual };
}
