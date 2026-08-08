/**
 * 「품목사전」 초기 시드 + 「구성해석」 초기 생성 + 자동해석 성공률 측정.
 *
 * 기존에 「⭐옵션매핑」에 입력돼 있던 원가(라벨→원가)를 품목사전 초기값으로 옮긴다.
 * 라벨이 여러 원가를 갖고 있으면(모순) 비워두고 사장님이 정하도록 남긴다.
 *
 * 실행: DRY_RUN=1 npx tsx seeditems.ts   ← 먼저 이걸로 확인
 *       npx tsx seeditems.ts
 */

import "dotenv/config";
import { loadCredsFromEnv, readRange, upsertRows, ensureTab } from "./sheets";
import {
  ITEM_TAB, ITEM_HEADERS, loadItems, parseComposition, formatComposition,
  loadCompRules, syncCompTab, compKey, costOfComposition, NEEDS_COMP,
  type Item,
} from "./itemdict";
import { setHeaderNotes } from "./sheets";
import { ITEM_NOTES } from "./itemdict";

const DRY_RUN = process.env.DRY_RUN === "1";
const c = loadCredsFromEnv();
if (!c) throw new Error("시트 자격증명 없음");

/**
 * 코드 기본 별칭 — 옵션 텍스트에 품목명이 그대로 안 나오는 경우 보정.
 * 사장님이 「품목사전」 C열에서 언제든 바꿀 수 있다.
 */
const SEED_ALIASES: Record<string, string[]> = {
  피쿠알: ["피쿠알품종"],
  아르베키나: ["아르베키나품종"],
  블렌딩: ["3종 블렌딩", "3종블렌딩"],
  아보카도오일: ["아보카도유", "하스품종", "아보카도 오일", "HASS 품종 아보카도", "하스 품종 아보카도"],
  레몬즙: ["올레샷", "NFC착즙 레몬즙", "레몬착즙", "레몬즙원액", "레몬 착즙"],
  종아리형: ["종아리"],
  무릎형: ["무릎"],
  허벅지형: ["허벅지"],
  윈트큐민: ["커큐민", "강황"],
  오메가3: ["알티지", "프로메가"],
  멜라토닌: ["타트체리"],
};

/** HANDOVER 에 기록돼 있던 매입가 — 시트에 없을 때만 초기값으로 쓴다. */
const KNOWN_COSTS: Record<string, number> = {
  허벅지형: 12650,
};

async function main() {
  // ── 1. ⭐옵션매핑 라벨 → 원가 수집 ──
  const mapRows = await readRange(c!, "⭐옵션매핑!A2:H10000");
  const labelCosts = new Map<string, Set<number>>();
  for (const r of mapRows) {
    const label = String(r[3] ?? "").trim();
    const cost = Number(String(r[4] ?? "").replace(/,/g, "")) || 0;
    if (!label || cost <= 0) continue;
    // "종아리형 / S" 처럼 사이즈가 붙어 있으면 앞부분만 품목으로
    const base = label.split("/")[0].trim();
    if (!base) continue;
    const s = labelCosts.get(base) ?? new Set<number>();
    s.add(cost);
    labelCosts.set(base, s);
  }

  // ── 2. 주문원본에서 등장 옵션 수집 ──
  const raw = await readRange(c!, "주문원본!A2:S100000");
  const seenMap = new Map<string, { productName: string; optionText: string; count: number }>();
  for (const r of raw) {
    const productName = String(r[5] ?? "");
    const optionText = String(r[6] ?? "").trim();
    if (!productName) continue;
    // 여기명품은 원가가 「여기명품 사입관리」 시트(실매입가)에서 오므로 구성 해석 대상이 아니다.
    // 여기까지 끌어오면 명품 잡화 수백 종이 "구성 정의 필요"로 쌓여 진짜 볼 것이 묻힌다.
    if (String(r[1] ?? "").trim() === "여기명품") continue;
    const k = compKey(productName, optionText);
    const cur = seenMap.get(k) ?? { productName, optionText, count: 0 };
    cur.count += 1;
    seenMap.set(k, cur);
  }
  const seen = [...seenMap.values()].sort((a, b) => b.count - a.count);

  // ── 3. 품목사전 시드 구성 ──
  const existingItems = await loadItems(c!);
  const existingByName = new Map(existingItems.map((i) => [i.name, i]));

  const names = new Set<string>([...Object.keys(SEED_ALIASES), ...labelCosts.keys()]);
  const seedRows: (string | number)[][] = [];
  const report: { name: string; cost: number | string; from: string }[] = [];

  for (const name of names) {
    const prev = existingByName.get(name);
    if (prev && prev.cost > 0) {
      report.push({ name, cost: prev.cost, from: "이미 입력됨(유지)" });
      continue; // 이미 사장님이 넣은 값은 건드리지 않음
    }
    const costs = labelCosts.get(name);
    let cost: number | "" = "";
    let from = "미확정 — 사장님 입력 필요";
    if (costs && costs.size === 1) {
      cost = [...costs][0];
      from = "⭐옵션매핑에서 자동 이전";
    } else if (costs && costs.size > 1) {
      from = `값이 여러 개(${[...costs].join("/")}) — 사장님이 결정`;
    } else if (KNOWN_COSTS[name] != null) {
      cost = KNOWN_COSTS[name];
      from = "인수인계 기록에서";
    }
    seedRows.push([name, cost, (SEED_ALIASES[name] ?? []).join(","), from === "미확정 — 사장님 입력 필요" ? "원가를 넣어주세요" : ""]);
    report.push({ name, cost: cost === "" ? "(비어있음)" : cost, from });
  }

  console.log("=== 품목사전 시드 ===");
  for (const r of report.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${r.name.padEnd(12)} ${String(r.cost).padStart(8)}   ${r.from}`);
  }

  if (!DRY_RUN && seedRows.length > 0) {
    await ensureTab(c!, ITEM_TAB, ITEM_HEADERS);
    try { await setHeaderNotes(c!, ITEM_TAB, ITEM_NOTES); } catch {}
    await upsertRows(c!, ITEM_TAB, seedRows, (r) => String(r[0] ?? ""));
    console.log(`\n✅ 「${ITEM_TAB}」 ${seedRows.length}개 시드`);
  }

  // ── 4. 자동해석 성공률 ──
  const items = DRY_RUN
    ? [...existingItems, ...seedRows.map((r) => ({
        name: String(r[0]), cost: Number(r[1]) || 0,
        aliases: String(r[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      } as Item))]
    : await loadItems(c!);

  let okCombos = 0, failCombos = 0, okRows = 0, failRows = 0;
  const failures: { productName: string; optionText: string; count: number }[] = [];
  for (const s of seen) {
    const parts = parseComposition(s.productName, s.optionText, items);
    if (parts) { okCombos += 1; okRows += s.count; }
    else { failCombos += 1; failRows += s.count; failures.push(s); }
  }
  const pct = (n: number, d: number) => d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "-";
  console.log(`\n=== 자동해석 성공률 ===`);
  console.log(`  옵션 조합 기준: ${okCombos}/${okCombos + failCombos} (${pct(okCombos, okCombos + failCombos)}) 해석됨`);
  console.log(`  주문 줄 기준  : ${okRows}/${okRows + failRows} (${pct(okRows, okRows + failRows)}) 해석됨`);
  console.log(`  수동 필요     : ${failCombos}개 조합 / ${failRows}줄`);
  console.log(`\n--- 수동 필요 상위 15 (건수순) ---`);
  for (const f of failures.slice(0, 15)) {
    console.log(`  ${String(f.count).padStart(4)} | ${f.productName.slice(0, 24)} || ${f.optionText.slice(0, 60)}`);
  }

  // 해석은 됐지만 원가가 없어 계산 못 하는 것
  let costMissingRows = 0;
  const missingItems = new Set<string>();
  for (const s of seen) {
    const parts = parseComposition(s.productName, s.optionText, items);
    if (!parts) continue;
    const { missing } = costOfComposition(parts, items);
    if (missing) {
      costMissingRows += s.count;
      for (const p of parts) {
        const it = items.find((i) => i.name === p.item);
        if (!it || it.cost <= 0) missingItems.add(p.item);
      }
    }
  }
  console.log(`\n=== 해석은 됐지만 품목 원가가 비어 계산 불가 ===`);
  console.log(`  ${costMissingRows}줄 / 품목: ${[...missingItems].join(", ") || "없음"}`);

  // ── 5. 구성해석 탭 생성 ──
  if (!DRY_RUN) {
    const existingRules = await loadCompRules(c!, items);
    const { needManual } = await syncCompTab(c!, seen, items, existingRules);
    console.log(`\n✅ 「구성해석」 ${seen.length}줄 (${NEEDS_COMP} ${needManual.length}줄)`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
