/**
 * 「⭐옵션매핑」 구조 마이그레이션 (반복 실행 안전).
 *
 * 2026-08-09 최종 구조로 맞춘다:
 *   ① A열 「스토어」 (없으면 주문원본에서 채움)
 *   ② 「원가(개당)」·「물류비(건당)」 열 삭제
 *      원가 → 품목사전+드롭다운, 물류비 → 「설정」 전역값으로 일원화됨
 *   ③ 「라벨」 → 「상품명」+「옵션명」 분리
 *      대표 줄 라벨은 상품명으로, 옵션 줄 라벨은 옵션명으로.
 *      옵션 줄의 상품명은 같은 채널상품번호의 대표 줄에서 가져와 채운다.
 *   ④ 여기명품 줄 제거 (사입관리로 원가가 오므로 매핑 불필요)
 *
 * 사장님 입력값(유형·메모·품목 선택)은 그대로 옮긴다.
 * 실행: DRY_RUN=1 npx tsx migrate_optmap.ts  →  npx tsx migrate_optmap.ts
 */

import "dotenv/config";
import { loadCredsFromEnv, readRange, writeRange, clearTabData } from "./sheets";
import {
  OPTMAP_TAB, OPTMAP_COL, OPTMAP_EXCLUDED_STORES, PRODUCT_ROW_MARK,
  ensureOptionMapTab, colOf, colA1,
} from "./optmap";

const DRY_RUN = process.env.DRY_RUN === "1";
const c = loadCredsFromEnv();
if (!c) throw new Error("시트 자격증명 없음");

interface Src {
  store: string; originNo: string; channelNo: string; optionCode: string;
  productName: string; optionName: string; type: string; memo: string; itemPick: string;
}

async function main() {
  const header = (await readRange(c!, `${OPTMAP_TAB}!A1:Z1`))[0] ?? [];
  const idx = (name: string) => header.findIndex((h) => String(h ?? "").trim() === name);
  const get = (r: string[], name: string) => {
    const i = idx(name);
    return i >= 0 ? String(r[i] ?? "").trim() : "";
  };
  console.log(`현재 헤더: ${header.filter(Boolean).join(" | ")}`);
  const hasSplit = idx(OPTMAP_COL.productName) >= 0 && idx(OPTMAP_COL.optionName) >= 0;
  const hasLabel = idx("라벨") >= 0;
  console.log(`상품명/옵션명 분리됨=${hasSplit} · 옛 라벨열 있음=${hasLabel}`);

  // 스토어 판정용
  const raw = await readRange(c!, "주문원본!A2:S100000");
  const storeOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  for (const r of raw) {
    const ch = String(r[4] ?? "").trim();
    if (!ch) continue;
    storeOf.set(ch, String(r[1] ?? "").trim());
    if (!nameOf.has(ch)) nameOf.set(ch, String(r[5] ?? "").trim());
  }

  const rows = await readRange(c!, `${OPTMAP_TAB}!A2:Z20000`);
  console.log(`옵션매핑 ${rows.length}행 읽음`);

  const src: Src[] = [];
  const droppedYeogi: string[] = [];
  const keptWithInput: string[] = [];

  for (const r of rows) {
    const channelNo = get(r, OPTMAP_COL.channelNo);
    if (!channelNo) continue;
    const store = get(r, OPTMAP_COL.store) || storeOf.get(channelNo) || "";
    const optionCode = get(r, OPTMAP_COL.optionCode);
    const type = get(r, OPTMAP_COL.type);
    const memo = get(r, OPTMAP_COL.memo);
    const itemPick = get(r, OPTMAP_COL.itemPick);

    // 라벨 → 상품명/옵션명
    let productName = hasSplit ? get(r, OPTMAP_COL.productName) : "";
    let optionName = hasSplit ? get(r, OPTMAP_COL.optionName) : "";
    if (!hasSplit && hasLabel) {
      const label = get(r, "라벨");
      if (optionCode) optionName = label;   // 옵션 줄 라벨 = 옵션명
      else productName = label;             // 대표 줄 라벨 = 상품명
    }

    const hasManual = [type, memo, itemPick].some((v) => v !== "" && v !== "원가를 넣어주세요");
    if (OPTMAP_EXCLUDED_STORES.has(store)) {
      if (hasManual) keptWithInput.push(`${channelNo} | ${productName || optionName} | 품목=${itemPick}`);
      else { droppedYeogi.push(channelNo); continue; }
    }
    src.push({ store, originNo: get(r, OPTMAP_COL.originNo), channelNo, optionCode, productName, optionName, type, memo, itemPick });
  }

  // 옵션 줄의 상품명 채우기 — 같은 채널상품번호 대표 줄 → 주문원본 순
  const prodByChannel = new Map<string, string>();
  for (const s of src) if (!s.optionCode && s.productName) prodByChannel.set(s.channelNo, s.productName);
  let filled = 0;
  for (const s of src) {
    if (s.productName) continue;
    const name = prodByChannel.get(s.channelNo) || nameOf.get(s.channelNo) || "";
    if (name) { s.productName = name; filled += 1; }
  }
  // 대표 줄 옵션명 표기 통일
  for (const s of src) if (!s.optionCode) s.optionName = PRODUCT_ROW_MARK;

  console.log(`\n남길 줄 ${src.length} / 여기명품 삭제 ${droppedYeogi.length} / 입력 있어 보존 ${keptWithInput.length}`);
  console.log(`옵션 줄 상품명 보충: ${filled}줄`);
  const noName = src.filter((s) => !s.productName).length;
  if (noName > 0) console.log(`⚠️ 상품명을 못 채운 줄 ${noName} (대표 줄·주문이력 모두 없음)`);
  const byStore = new Map<string, number>();
  for (const s of src) byStore.set(s.store || "(공란)", (byStore.get(s.store || "(공란)") ?? 0) + 1);
  console.log("스토어별:", JSON.stringify([...byStore.entries()]));
  if (keptWithInput.length > 0) {
    console.log("⚠️ 여기명품이지만 입력이 있어 보존:");
    for (const s of keptWithInput) console.log(`   ${s}`);
  }

  const toRow = (s: Src) => {
    const row = new Array(colOf(OPTMAP_COL.itemPick) + 1).fill("");
    row[colOf(OPTMAP_COL.store)] = s.store;
    row[colOf(OPTMAP_COL.originNo)] = s.originNo;
    row[colOf(OPTMAP_COL.channelNo)] = s.channelNo;
    row[colOf(OPTMAP_COL.optionCode)] = s.optionCode;
    row[colOf(OPTMAP_COL.productName)] = s.productName.slice(0, 60);
    row[colOf(OPTMAP_COL.optionName)] = s.optionName;
    row[colOf(OPTMAP_COL.type)] = s.type;
    row[colOf(OPTMAP_COL.memo)] = s.memo;
    row[colOf(OPTMAP_COL.itemPick)] = s.itemPick;
    return row;
  };

  if (DRY_RUN) {
    console.log("\n[DRY_RUN] 시트 미변경. 상위 4줄:");
    for (const s of src.slice(0, 4)) console.log("   " + JSON.stringify(toRow(s)));
    return;
  }

  // 같은 상품끼리 붙여 보이도록 채널상품번호 그룹 + 대표 줄 먼저
  const order = new Map<string, Src[]>();
  for (const s of src) (order.get(s.channelNo) ?? order.set(s.channelNo, []).get(s.channelNo)!).push(s);
  const sorted: Src[] = [];
  for (const [, list] of order) {
    sorted.push(...list.filter((s) => !s.optionCode), ...list.filter((s) => s.optionCode));
  }

  await clearTabData(c!, OPTMAP_TAB);
  await ensureOptionMapTab(c!); // 헤더·노트·드롭다운·수식·시각 정리
  const CHUNK = 500;
  for (let i = 0; i < sorted.length; i += CHUNK) {
    const slice = sorted.slice(i, i + CHUNK).map(toRow);
    const from = i + 2;
    await writeRange(c!, `${OPTMAP_TAB}!A${from}:${colA1(OPTMAP_COL.itemPick)}${from + slice.length - 1}`, slice);
    console.log(`  기록 ${Math.min(i + CHUNK, sorted.length)}/${sorted.length}`);
  }
  await ensureOptionMapTab(c!); // 수식 재확인
  console.log(`\n✅ 마이그레이션 완료 — ${sorted.length}줄`);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
