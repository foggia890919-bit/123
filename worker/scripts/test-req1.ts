// 요구1 검증 — buildInsuredRow: 급여 supply=보험약가(낱개), discount=0, 약가 없으면 낱개 폴백.
import { buildInsuredRow, type YkProductLite, type YkSku } from "../src/export-offers.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got: unknown) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} — got ${JSON.stringify(got)}`); }
}

const prod = (base: number | null): YkProductLite => ({
  id: "p1", code: "643703630", name: "테스트정", maker: "제약사", coverage: "급여", base_price: base, std_code: null, spec: "30정",
});
const skus: YkSku[] = [{ std_code: "8801234567890", pack_qty: 30, sort_order: 0 }];

// 1) 약가 있음: supply=약가(437), discount=0, 사이트 단가(13110, 30정 포장가)는 가격산정에 안 씀.
{
  const { row } = buildInsuredRow(
    { code: "643703630", name: "테스트정", spec: "30정", stock: 12, unitPrice: 13110 },
    prod(437), skus, "wh1", "2026-07-29T00:00:00Z"
  );
  check("약가있음 supply=437", row.supply_price === 437, row.supply_price);
  check("약가있음 discount=0", row.discount_rate === 0, row.discount_rate);
  check("표준코드 채움(30정 SKU)", row.std_code === "8801234567890", row.std_code);
}

// 2) 약가 없음: 폴백 = 사이트 단가 ÷ 포장수량(규격 30T, parsePackCount 인식) = 13110/30 = 437, discount=0.
{
  const { row } = buildInsuredRow(
    { code: "643703630", name: "테스트정", spec: "30T", stock: 12, unitPrice: 13110 },
    prod(null), skus, "wh1", "2026-07-29T00:00:00Z"
  );
  check("약가없음 폴백 supply=437", row.supply_price === 437, row.supply_price);
  check("약가없음 discount=0", row.discount_rate === 0, row.discount_rate);
}

// 3) 약가 있음 + 사이트 단가가 낱개가여도(437) supply 는 약가 그대로(437), discount=0 (허위할인 없음).
{
  const { row } = buildInsuredRow(
    { code: "643703630", name: "테스트정", spec: "30정", stock: 5, unitPrice: 437 },
    prod(437), skus, "wh1", "2026-07-29T00:00:00Z"
  );
  check("낱개단가라도 supply=약가437", row.supply_price === 437, row.supply_price);
  check("discount=0", row.discount_rate === 0, row.discount_rate);
}

console.log(`\n요구1 결과: PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
