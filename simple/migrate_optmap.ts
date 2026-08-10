/**
 * 「⭐옵션매핑」 1회성 마이그레이션 (2026-08-09).
 *
 *   ① A열에 「스토어」 삽입 — 기존 열이 한 칸씩 오른쪽으로 밀린다
 *   ② 여기명품 줄 제거 — 사입가가 건건이 달라 품목사전 방식이 안 맞고,
 *      원가는 이미 「여기명품 사입관리」 실매입가로 들어온다
 *      단, 사장님이 손으로 넣은 값(원가·물류비·유형·메모·품목)이 있는 줄은 **보존**하고 목록으로 보고
 *
 * 사장님 입력값(원가/물류비/유형/메모/품목)은 그대로 옮긴다. 검수열은 다음 실행 때 다시 채워진다.
 *
 * 실행: DRY_RUN=1 npx tsx migrate_optmap.ts   ← 먼저 확인
 *       npx tsx migrate_optmap.ts
 * 반복 실행해도 안전(이미 스토어 열이면 삽입을 건너뜀).
 */

import "dotenv/config";
import { loadCredsFromEnv, readRange, writeRange, clearTabData } from "./sheets";
import {
  OPTMAP_TAB, OPTMAP_HEADERS, OPTMAP_COL, OPTMAP_EXCLUDED_STORES,
  ensureOptionMapTab, colOf, colA1,
} from "./optmap";

const DRY_RUN = process.env.DRY_RUN === "1";
const c = loadCredsFromEnv();
if (!c) throw new Error("시트 자격증명 없음");

/** 옛 열 순서 (A열 스토어 삽입 전) */
const OLD = {
  originNo: 0, channelNo: 1, optionCode: 2, label: 3,
  cost: 4, logistics: 5, type: 6, memo: 7, itemPick: 8,
};

async function main() {
  const header = (await readRange(c!, `${OPTMAP_TAB}!A1:A1`))[0] ?? [];
  const alreadyMigrated = String(header[0] ?? "").trim() === OPTMAP_COL.store;
  console.log(`현재 A1 = "${header[0] ?? ""}" → ${alreadyMigrated ? "이미 마이그레이션됨" : "옛 구조"}`);

  // 스토어 판정용: 주문원본에서 채널상품번호 → 스토어
  const raw = await readRange(c!, "주문원본!A2:S100000");
  const storeOf = new Map<string, string>();
  for (const r of raw) {
    const ch = String(r[4] ?? "").trim();
    if (ch) storeOf.set(ch, String(r[1] ?? "").trim());
  }

  const width = alreadyMigrated ? colOf(OPTMAP_COL.itemPick) : OLD.itemPick;
  const rows = await readRange(c!, `${OPTMAP_TAB}!A2:${String.fromCharCode(65 + width)}20000`);
  console.log(`옵션매핑 ${rows.length}행 읽음`);

  const kept: (string | number)[][] = [];
  const droppedYeogi: string[] = [];
  const keptYeogiWithInput: string[] = [];

  for (const r of rows) {
    const g = (i: number) => String(r[i] ?? "").trim();
    const src = alreadyMigrated
      ? {
          store: g(colOf(OPTMAP_COL.store)),
          originNo: g(colOf(OPTMAP_COL.originNo)),
          channelNo: g(colOf(OPTMAP_COL.channelNo)),
          optionCode: g(colOf(OPTMAP_COL.optionCode)),
          label: g(colOf(OPTMAP_COL.label)),
          cost: g(colOf(OPTMAP_COL.cost)),
          logistics: g(colOf(OPTMAP_COL.logistics)),
          type: g(colOf(OPTMAP_COL.type)),
          memo: g(colOf(OPTMAP_COL.memo)),
          itemPick: g(colOf(OPTMAP_COL.itemPick)),
        }
      : {
          store: "",
          originNo: g(OLD.originNo), channelNo: g(OLD.channelNo), optionCode: g(OLD.optionCode),
          label: g(OLD.label), cost: g(OLD.cost), logistics: g(OLD.logistics),
          type: g(OLD.type), memo: g(OLD.memo), itemPick: g(OLD.itemPick),
        };

    if (!src.channelNo) continue;
    const store = src.store || storeOf.get(src.channelNo) || "";

    // 사장님이 직접 넣은 값이 하나라도 있으면 "수동 입력 있음"
    const hasManual = [src.cost, src.logistics, src.type, src.memo, src.itemPick]
      .some((v) => v !== "" && v !== "원가를 넣어주세요");

    if (OPTMAP_EXCLUDED_STORES.has(store)) {
      if (hasManual) {
        keptYeogiWithInput.push(`${src.channelNo} | ${src.label.slice(0, 34)} | 원가=${src.cost} 물류=${src.logistics} 품목=${src.itemPick}`);
      } else {
        droppedYeogi.push(src.channelNo);
        continue; // 입력값 없는 여기명품 줄은 버린다
      }
    }

    const row = new Array(colOf(OPTMAP_COL.itemPick) + 1).fill("");
    row[colOf(OPTMAP_COL.store)] = store;
    row[colOf(OPTMAP_COL.originNo)] = src.originNo;
    row[colOf(OPTMAP_COL.channelNo)] = src.channelNo;
    row[colOf(OPTMAP_COL.optionCode)] = src.optionCode;
    row[colOf(OPTMAP_COL.label)] = src.label;
    row[colOf(OPTMAP_COL.cost)] = src.cost;
    row[colOf(OPTMAP_COL.logistics)] = src.logistics;
    row[colOf(OPTMAP_COL.type)] = src.type;
    row[colOf(OPTMAP_COL.memo)] = src.memo;
    row[colOf(OPTMAP_COL.itemPick)] = src.itemPick;
    kept.push(row);
  }

  const byStore = new Map<string, number>();
  for (const r of kept) {
    const s = String(r[colOf(OPTMAP_COL.store)] || "(미판매)");
    byStore.set(s, (byStore.get(s) ?? 0) + 1);
  }
  console.log(`\n남길 줄 ${kept.length} / 여기명품 삭제 ${droppedYeogi.length} / 여기명품인데 입력 있어 보존 ${keptYeogiWithInput.length}`);
  console.log("스토어별:");
  for (const [s, n] of [...byStore.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${s || "(공란)"} : ${n}`);
  if (keptYeogiWithInput.length > 0) {
    console.log("\n⚠️ 여기명품이지만 수동 입력이 있어 보존한 줄:");
    for (const s of keptYeogiWithInput) console.log(`   ${s}`);
  }

  if (DRY_RUN) {
    console.log("\n[DRY_RUN] 시트 미변경. 상위 3줄 미리보기:");
    for (const r of kept.slice(0, 3)) console.log("   " + JSON.stringify(r));
    return;
  }

  // 데이터 영역 비우고 새 구조로 다시 씀 (헤더는 ensureOptionMapTab 이 세움)
  await clearTabData(c!, OPTMAP_TAB);
  await ensureOptionMapTab(c!); // 헤더·노트·드롭다운·ARRAYFORMULA 재설정
  if (kept.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < kept.length; i += CHUNK) {
      const slice = kept.slice(i, i + CHUNK);
      const from = i + 2;
      await writeRange(
        c!,
        `${OPTMAP_TAB}!A${from}:${colA1(OPTMAP_COL.itemPick)}${from + slice.length - 1}`,
        slice,
      );
      console.log(`  기록 ${Math.min(i + CHUNK, kept.length)}/${kept.length}`);
    }
  }
  // 데이터를 쓴 뒤 ARRAYFORMULA 를 다시 심는다 (clear 로 날아갔을 수 있음)
  await ensureOptionMapTab(c!);
  console.log(`\n✅ 마이그레이션 완료 — ${kept.length}줄, A열 「${OPTMAP_COL.store}」 삽입`);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
