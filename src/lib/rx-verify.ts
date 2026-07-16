// 처방통계 행 단위 "이중 검산" + 3단계 상태 판정 — 순수 함수 (DB/네트워크 접근 없음).
//
// 검산 A (산술): 추출 단가 × 수량 = 금액 인가. 허용오차는 반올림 수준으로 엄격.
// 검산 B (마스터 약가): 보험코드(청구코드)가 읽힌 행이면 마스터DB(심평원 약가, 주간 동기화)
//   공식 약가로 ① 공식약가 × 수량 ≈ 금액, ② 금액 ÷ 공식약가 = 수량 역산 대조.
//   보험코드가 없거나 마스터에 없으면 검산 B 는 "해당없음(패스)" — 실패가 아니다.
//
// 최종 상태 (3가지로 명확히 구분):
//   unreadable — Gemini 가 못 읽어 null 인 셀이 하나라도 있는 행. 절대 추정값으로 안 채움.
//   mismatch   — 검산 A 또는 B 가 실제로 어긋남 (어느 검산이 무슨 값으로 어긋났는지 detail 에).
//   verified   — 검산 A 통과 + (검산 B 통과 또는 미실시). B 미실시면 masterPriceChecked=false
//                ("약가대조 미실시" 부가 표시).

export type RxRowStatus = "verified" | "mismatch" | "unreadable";

// 이중 판독(Gemini + 클로바 OCR) 교차검증 결과. dual-read.ts 가 채워 넣는다.
//   agree         — 클로바 숫자와 일치 (신뢰 상승)
//   clova-adopted — Gemini 값이 검산 실패, 클로바 값으로 교체해 통과
//   gemini-kept   — 불일치했으나 Gemini 값 유지 (검산 통과 또는 양쪽 실패)
//   gemini-only   — 클로바에서 행을 못 찾아 Gemini 단독 결과 유지
export type RxDualReadTag = "agree" | "clova-adopted" | "gemini-kept" | "gemini-only";
export interface RxDualRead {
  tag: RxDualReadTag;
  detail: string;
}

export interface RxCheck {
  // 검산에 필요한 값이 모두 있어 실제로 검사를 수행했는가.
  applicable: boolean;
  // applicable=true 일 때만 의미 있음. false = 값이 어긋남.
  pass: boolean;
  // 어긋난 경우 사람이 읽을 설명 (어떤 값이 어떻게 어긋났는지).
  detail: string;
}

export interface RxRowVerification {
  status: RxRowStatus;
  checkA: RxCheck;               // 산술 검산
  checkB: RxCheck;               // 마스터 약가 검산
  unreadableCells: string[];     // 못 읽은 셀 키: "quantity" | "unitPrice" | "totalPrice" | "productName"
  masterPriceChecked: boolean;   // 검산 B 실시 여부 (false = 약가대조 미실시 / 해당없음)
  dualRead?: RxDualRead | null;  // 클로바 이중 판독 교차검증 결과 (미실시/폴백이면 없음/gemini-only)
}

// 검산에 넣는 한 행. 숫자 셀은 판독 불가면 null (추정값 금지).
export interface VerifyRxRowInput {
  quantity: number | null;        // 사진에서 읽은 총사용량
  unitPrice: number | null;       // 사진에서 읽은 단가 (OCR 원본)
  totalPrice: number | null;      // 사진에서 읽은 금액 (OCR 원본)
  insuranceCode: string;          // 보험코드 9자리 (없거나 못 읽었으면 "")
  productName: string;            // 사진에서 읽은 약품명
  masterUnitPrice: number | null; // 마스터DB 공식 약가. 매칭 실패 시 null
}

// 반올림 수준 허용오차: 두 값 차이가 max(1원, 기대값의 0.1%) 이내면 일치로 본다.
// (EMR 이 단가·금액을 원 단위로 반올림해 표시하는 경우 대비 — 그 이상 벌어지면 진짜 불일치)
function approxEqual(a: number, b: number): boolean {
  const tol = Math.max(1, Math.abs(a) * 0.001);
  return Math.abs(a - b) <= tol;
}

// 소수 2자리까지만 반올림 (역산 수량 표기용)
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const NOT_APPLICABLE: RxCheck = { applicable: false, pass: true, detail: "" };

export function verifyRxRow(input: VerifyRxRowInput): RxRowVerification {
  const { quantity, unitPrice, totalPrice, insuranceCode, masterUnitPrice } = input;
  const code = (insuranceCode || "").replace(/\D/g, "");

  // ── 판독 불가(null) 셀 수집 ──
  // 사진에 애초에 컬럼이 없으면 Gemini 는 0/빈값(해당없음)을 주므로, null 인 셀만 unreadable 로 본다.
  const unreadableCells: string[] = [];
  if (quantity === null) unreadableCells.push("quantity");
  if (unitPrice === null) unreadableCells.push("unitPrice");
  if (totalPrice === null) unreadableCells.push("totalPrice");
  if (!input.productName || !input.productName.trim()) unreadableCells.push("productName");

  // ── 검산 A: 단가 × 수량 = 금액 ──
  let checkA: RxCheck = NOT_APPLICABLE;
  if (
    unitPrice !== null && unitPrice > 0 &&
    quantity !== null && quantity > 0 &&
    totalPrice !== null && totalPrice > 0
  ) {
    const expected = unitPrice * quantity;
    const ok = approxEqual(expected, totalPrice);
    checkA = {
      applicable: true,
      pass: ok,
      detail: ok ? "" : `단가×수량=${Math.round(expected).toLocaleString()} ≠ 금액 ${totalPrice.toLocaleString()}`,
    };
  }

  // ── 검산 B: 마스터 약가 대조 ──
  let checkB: RxCheck = NOT_APPLICABLE;
  const masterPriceChecked = code.length === 9 && masterUnitPrice !== null && masterUnitPrice > 0;
  if (masterPriceChecked) {
    const problems: string[] = [];

    // 공식약가 vs 추출 단가 (단가가 읽힌 경우)
    if (unitPrice !== null && unitPrice > 0 && !approxEqual(masterUnitPrice!, unitPrice)) {
      problems.push(`공식약가 ${masterUnitPrice!.toLocaleString()} ≠ 추출단가 ${unitPrice.toLocaleString()}`);
    }

    if (quantity !== null && quantity > 0 && totalPrice !== null && totalPrice > 0) {
      // ① 공식약가 × 수량 ≈ 금액
      const expected = masterUnitPrice! * quantity;
      if (!approxEqual(expected, totalPrice)) {
        problems.push(`공식약가×수량=${Math.round(expected).toLocaleString()} ≠ 금액 ${totalPrice.toLocaleString()}`);
      }
      // ② 금액 ÷ 공식약가 = 수량 역산 → 추출 수량과 대조
      const reverseQty = totalPrice / masterUnitPrice!;
      if (!approxEqual(reverseQty, quantity)) {
        problems.push(`금액÷공식약가=${round2(reverseQty).toLocaleString()} ≠ 수량 ${quantity.toLocaleString()}`);
      }
    }

    checkB = { applicable: true, pass: problems.length === 0, detail: problems.join("; ") };
  }

  // ── 최종 상태 판정 ── (unreadable 우선 — 못 읽은 행은 검산 자체가 신뢰 불가)
  let status: RxRowStatus;
  if (unreadableCells.length > 0) {
    status = "unreadable";
  } else if ((checkA.applicable && !checkA.pass) || (checkB.applicable && !checkB.pass)) {
    status = "mismatch";
  } else {
    status = "verified";
  }

  return { status, checkA, checkB, unreadableCells, masterPriceChecked };
}

// 상태별 짧은 한글 라벨 (UI 배지/툴팁 공용).
export function rowStatusLabel(status: RxRowStatus): string {
  switch (status) {
    case "verified": return "검증완료";
    case "mismatch": return "검산 불일치";
    case "unreadable": return "판독 불가";
  }
}
