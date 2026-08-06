/**
 * 「주문원본」 과거 누적분 재계산 (1회성, 반복 실행해도 안전).
 *
 * 하는 일 — Q·R·S 세 칼럼만 다시 씀 (나머지 칼럼은 손대지 않음):
 *   1. 물류비(Q)를 묶음배송 기준으로 재계산
 *      기존: 행마다 부과 → 같은 주문에 상품 2개면 실제 출고는 1회인데 2회분 차감
 *      변경: 주문번호당 1회만, 여러 상품이 섞이면 후보 중 최댓값(큰 박스 기준)
 *   2. 수취배송비(S)를 분리 기록
 *      과거 행에는 배송비가 「매출」에 합산돼 있고 따로 남아 있지 않지만,
 *      매출 = 상품가 + 배송비 이고 수수료 = 상품가 − 정산예정 이므로
 *        배송비 = 매출 − 수수료 − 정산예정
 *      으로 복원된다. (2026-08-05 실데이터 3건으로 검증: 모두 4,000원)
 *   3. 이익(R) = 정산예정 − 원가 − 물류비(신) + 배송비 로 다시 계산
 *
 * 취소건(정산·원가 칸이 빈 행)과 원가가 「설정 필요」인 행은 건드리지 않는다.
 *
 * 실행: npx tsx backfill.ts             (전체)
 *       DRY_RUN=1 npx tsx backfill.ts   (계산만 하고 시트 안 씀 — 먼저 이걸로 확인)
 */

import "dotenv/config";
import { loadCredsFromEnv, readRange, writeRange } from "./sheets";

const DRY_RUN = process.env.DRY_RUN === "1";
const SETUP_NEEDED = "설정 필요";
/** 「매출」 칼럼에 배송비를 합산하기 시작한 시점 (커밋 6af2359). 이전 행은 배송비 복원 대상 아님. */
const FEE_EPOCH = "2026-06-05";
const c = loadCredsFromEnv();
if (!c) throw new Error("시트 자격증명 없음 (GOOGLE_* 환경변수 확인)");

const num = (v: unknown) => Number(String(v ?? "").replace(/,/g, "")) || 0;
const isCanceled = (s: string) => /취소|반품|환불|cancel|refund|return/i.test(s);
const won = (n: number) => n.toLocaleString("ko-KR");

async function main() {
  // A2:S — 0결제일 2주문번호 10매출 11수수료 12정산예정 13상태 15원가 16물류비 17이익 18배송비
  const rows = await readRange(c!, "주문원본!A2:S100000");
  console.log(`주문원본 ${rows.length}행 읽음${DRY_RUN ? " [DRY_RUN]" : ""}`);

  // 1) 주문번호별 물류비 최댓값
  const maxLogiByOrder = new Map<string, number>();
  for (const r of rows) {
    const oid = String(r[2] ?? "").trim();
    if (!oid || isCanceled(String(r[13] ?? ""))) continue;
    const logi = num(r[16]);
    if (logi > (maxLogiByOrder.get(oid) ?? 0)) maxLogiByOrder.set(oid, logi);
  }

  // 2) 행별 재계산 — 주문의 첫 유효행에만 물류비를 싣는다
  const charged = new Set<string>();
  const out: (string | number)[][] = [];
  let changedLogi = 0, changedProfit = 0, filledFee = 0, skipped = 0, unknown = 0;
  let profitDelta = 0;
  const bundleOrders = new Set<string>();

  for (const r of rows) {
    const oldLogi = num(r[16]);
    const oldProfit = num(r[17]);
    const status = String(r[13] ?? "");
    const settlementRaw = String(r[12] ?? "").trim();
    const costRaw = String(r[15] ?? "").trim();

    // 취소건·정산 미확정·원가 미설정 행은 그대로 둔다
    if (isCanceled(status) || settlementRaw === "" || costRaw === SETUP_NEEDED) {
      out.push([r[16] ?? "", r[17] ?? "", r[18] ?? ""]);
      skipped += 1;
      continue;
    }

    const oid = String(r[2] ?? "").trim();
    const sales = num(r[10]);
    const commission = num(r[11]);
    const settlement = num(settlementRaw);
    const cost = num(costRaw);

    // 배송비 복원.
    // 후보값: 매출 = 상품가 + 배송비, 수수료 = 상품가 − 정산예정 이므로
    //   매출 − 수수료 − 정산예정 = 배송비.
    // 다만 이 항등식은 그 행을 "어느 버전 코드가 썼는지"에 따라 성립 여부가 갈린다
    // (2026-05-14 이전 행은 수수료가 API 수수료라 엉뚱한 값이 나옴). 결제일로 가르면
    // 과거 날짜를 나중 코드로 백필한 행을 놓치므로, 날짜 대신 **행 자체의 정합성**으로 판정한다:
    // 저장된 이익이 「배송비 포함」식과 맞으면 그 행은 배송비를 갖고 있는 것이고,
    // 「배송비 없음」식과 맞으면 없는 것이다. 둘 다 아니면 알 수 없으므로 손대지 않는다.
    const feeCandidate = Math.max(0, sales - commission - settlement);
    const baseProfit = settlement - cost - oldLogi;
    let fee: number;
    if (oldProfit === baseProfit + feeCandidate) {
      fee = feeCandidate;            // 배송비가 반영된 행
    } else if (oldProfit === baseProfit) {
      fee = 0;                       // 배송비 개념 이전 행
    } else {
      out.push([r[16] ?? "", r[17] ?? "", r[18] ?? ""]); // 판정 불가 — 원본 보존
      unknown += 1;
      continue;
    }

    // 물류비: 주문당 1회 (최댓값), 이미 부과했으면 0
    let newLogi = 0;
    if (oid) {
      if (!charged.has(oid)) {
        newLogi = maxLogiByOrder.get(oid) ?? oldLogi;
        charged.add(oid);
      }
    } else {
      newLogi = oldLogi;
    }

    const newProfit = settlement - cost - newLogi + fee;

    if (newLogi !== oldLogi) { changedLogi += 1; bundleOrders.add(oid); }
    if (newProfit !== oldProfit) { changedProfit += 1; profitDelta += newProfit - oldProfit; }
    if (String(r[18] ?? "").trim() === "") filledFee += 1;

    out.push([newLogi, newProfit, fee]);
  }

  console.log(`\n재계산 결과`);
  console.log(`  물류비 바뀐 행   : ${changedLogi}`);
  console.log(`  이익 바뀐 행     : ${changedProfit}`);
  console.log(`  배송비 새로 채움 : ${filledFee}`);
  console.log(`  건드리지 않은 행 : ${skipped} (취소·정산미확정·원가미설정)`);
  console.log(`  판정 불가로 보존 : ${unknown} (저장된 이익이 어느 계산식과도 안 맞음)`);
  console.log(`  이익 합계 변화   : ${profitDelta >= 0 ? "+" : ""}${won(profitDelta)}원`);
  console.log(`  묶음배송으로 정정된 주문: ${bundleOrders.size}건`);

  if (DRY_RUN) {
    console.log("\n[DRY_RUN] 시트 미기록. 상위 5행 미리보기 (물류비, 이익, 배송비):");
    for (const r of out.slice(0, 5)) console.log("   ", JSON.stringify(r));
    return;
  }

  // 3) Q:S 한 번에 쓰기 (연속 칼럼) — 500행씩 나눠서
  const CHUNK = 500;
  for (let i = 0; i < out.length; i += CHUNK) {
    const slice = out.slice(i, i + CHUNK);
    const from = i + 2; // 헤더 1행 다음부터
    await writeRange(c!, `주문원본!Q${from}:S${from + slice.length - 1}`, slice);
    console.log(`  기록 ${Math.min(i + CHUNK, out.length)}/${out.length}`);
  }
  console.log("\n✅ 백필 완료");
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
