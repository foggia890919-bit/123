// 행 단위 추출 품질 검증 — 순수 함수.
// fusion-adapter, photo-auto background, photo-edit 모두 이 함수를 공유해서
// 행별 finalConfidence(0~100) 와 qualityChecks 객체를 만든다.
//
// 검증 항목:
//   masterMatch  — 마스터 DB 보험코드+이름 매칭 (가장 큰 가중치)
//   prefixMatch  — 마스터 제품명 vs OCR 제품명 한글 prefix 3자 일치
//   priceMatch   — Gemini 추출 단가 vs 마스터 단가
//   revenueMatch — Gemini 추출 매출 vs 수량×단가
//
// "applicable=false" 는 검증 필요한 데이터가 없다는 뜻. 점수 가중에서 제외.
// (옛 데이터/Gemini 가 priceHint 미반환 시에도 자연스럽게 동작)

export interface QualityCheck {
  applicable: boolean;
  matched: boolean;
  detail?: string;
}

export interface RowQualityChecks {
  masterMatch: QualityCheck;
  prefixMatch: QualityCheck;
  priceMatch: QualityCheck;
  revenueMatch: QualityCheck;
}

export interface RowScoreResult {
  overall: number;
  matchedAll: boolean;
  applicableCount: number;
  matchedCount: number;
}

// 마스터 매칭 — 코드+이름 다 통과(50), 코드만(30), 이름만(25), 미매칭(0).
// 이름 prefix check 는 별도 prefixMatch 에서 다시 보지만 — 마스터 매칭 자체의 강도 평가.
export function checkMasterMatch(
  matchedMedicationId: string | null,
  codeOk: boolean,
  nameSimilar: boolean,
): { check: QualityCheck; weight: number; score: number } {
  if (matchedMedicationId && codeOk && nameSimilar) {
    return { check: { applicable: true, matched: true, detail: "보험코드+이름 마스터 매칭" }, weight: 50, score: 50 };
  }
  if (matchedMedicationId && codeOk) {
    return { check: { applicable: true, matched: false, detail: "보험코드 매칭, 이름 불일치" }, weight: 50, score: 30 };
  }
  if (matchedMedicationId) {
    return { check: { applicable: true, matched: false, detail: "제품명 폴백 매칭 (코드 미매칭)" }, weight: 50, score: 25 };
  }
  return { check: { applicable: true, matched: false, detail: "마스터 미매칭" }, weight: 50, score: 0 };
}

// 제품명 prefix 3자 일치. 마스터 매칭값 있고 ocr 값도 있을 때만 applicable.
// 보험코드 매칭은 됐지만 prefix 다르면 mismatch 알림 후보.
const PREFIX_LEN = 3;

function koreanPrefix(s: string, n: number): string {
  if (!s) return "";
  const match = s.match(/[가-힣]+/g);
  if (!match) return "";
  return match.join("").slice(0, n);
}

export function checkPrefixMatch(masterName: string, ocrName: string): QualityCheck {
  if (!masterName || !ocrName) return { applicable: false, matched: false };
  const a = koreanPrefix(masterName, PREFIX_LEN);
  const b = koreanPrefix(ocrName, PREFIX_LEN);
  if (a.length < PREFIX_LEN || b.length < PREFIX_LEN) {
    return { applicable: false, matched: false };
  }
  return { applicable: true, matched: a === b, detail: a === b ? "" : `${a} vs ${b}` };
}

// Gemini 단가 vs 마스터 단가. 둘 다 양수일 때만 applicable. 10% 허용 (반올림 차이/특수가).
export function checkPriceMatch(geminiPrice: number | undefined, masterPrice: number | null): QualityCheck {
  if (!geminiPrice || !masterPrice || geminiPrice <= 0 || masterPrice <= 0) {
    return { applicable: false, matched: false };
  }
  const diff = Math.abs(geminiPrice - masterPrice) / masterPrice;
  return {
    applicable: true,
    matched: diff <= 0.1,
    detail: diff <= 0.1 ? "" : `Gemini ${geminiPrice} vs 마스터 ${masterPrice}`,
  };
}

// 매출=수량×단가 검증. Gemini 가 totalPrice 와 unitPrice 둘 다 반환했을 때만 applicable. 5% 허용.
export function checkRevenueMatch(
  quantity: number,
  unitPrice: number,
  totalPrice: number,
): QualityCheck {
  if (!quantity || !unitPrice || !totalPrice || quantity <= 0 || unitPrice <= 0 || totalPrice <= 0) {
    return { applicable: false, matched: false };
  }
  const expected = quantity * unitPrice;
  const diff = Math.abs(expected - totalPrice) / Math.max(expected, totalPrice);
  return {
    applicable: true,
    matched: diff <= 0.05,
    detail: diff <= 0.05 ? "" : `예상 ${Math.round(expected)} vs 추출 ${totalPrice}`,
  };
}

// 사진 단위 합계 검증 — Gemini summary.totalAmountWon 과 행 합산이 맞는가. 5% 허용.
export function checkTotalSum(rowSums: number, summaryTotal: number): QualityCheck {
  if (!rowSums || !summaryTotal || rowSums <= 0 || summaryTotal <= 0) {
    return { applicable: false, matched: false };
  }
  const diff = Math.abs(rowSums - summaryTotal) / Math.max(rowSums, summaryTotal);
  return {
    applicable: true,
    matched: diff <= 0.05,
    detail: diff <= 0.05 ? "" : `행 합산 ${rowSums} vs 표 합계 ${summaryTotal}`,
  };
}

// ── 사용량/처방금액 산술 재분류 (기울어진 사진·칸 섞임 교정) ───────────────────
// 마스터 약가(P)가 정답 기준. 한 행에서 Gemini 가 읽은 숫자들(사용량·처방횟수·단가·금액
// 칸 값) 중 a × P ≈ b 를 만족하는 (a=사용량, b=처방금액) 쌍을 찾아 재배치한다.
// 비스듬한 표에서 인접 행/칸 값을 잘못 가져와도 약가 관계로 올바른 쌍을 복원하고,
// 어떤 쌍도 관계를 못 맞추면 reliable=false 로 검수(빨강) 표시한다.
export interface QtyPriceReconcile {
  quantity: number;     // 교정된 사용량(처방량)
  totalPrice: number;   // 교정된 처방금액
  corrected: boolean;   // Gemini 원래 칸값에서 바뀌었는지
  reliable: boolean;    // 약가 산술관계로 확정됐는지 (false 면 검수 필요)
  note: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function reconcileQtyPrice(opts: {
  masterUnitPrice: number | null;  // 마스터 약가 = 기준점
  quantity: number;                // Gemini 사용량 칸
  prescriptions: number;           // Gemini 처방횟수 칸
  unitPrice: number;               // Gemini 단가 칸
  totalPrice: number;              // Gemini 금액 칸
}): QtyPriceReconcile {
  const P = opts.masterUnitPrice;
  const q0 = opts.quantity;
  const t0 = opts.totalPrice;
  const rel = (a: number, b: number, tol: number) =>
    a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= tol;

  // 마스터 약가 없으면 기준점 없음 → Gemini 값 유지. 자체 관계(사용량×단가=금액)만 검증.
  if (!P || P <= 0) {
    const ok = rel(q0 * opts.unitPrice, t0, 0.05);
    return { quantity: q0, totalPrice: t0, corrected: false, reliable: ok,
             note: ok ? "" : "마스터 약가 없음 — 관계검증 불가" };
  }

  // 1) Gemini 사용량 × 약가 ≈ 금액 이면 그대로 신뢰 (칸 안 섞임)
  if (rel(q0 * P, t0, 0.06)) {
    return { quantity: q0, totalPrice: t0, corrected: false, reliable: true, note: "" };
  }

  // 2) 행의 모든 숫자 후보 중 a × P ≈ b 인 (a=사용량, b=금액) 쌍 탐색.
  //    Gemini 원래 칸(q0=사용량, t0=금액)과 일치할수록 우선 채택.
  const cands = Array.from(new Set(
    [opts.quantity, opts.prescriptions, opts.unitPrice, opts.totalPrice].filter((v) => v > 0),
  ));
  let best: { a: number; b: number; prefer: number; err: number } | null = null;
  for (const a of cands) {
    for (const b of cands) {
      if (a === b) continue;
      if (!rel(a * P, b, 0.06)) continue;
      const prefer = (a === q0 ? 2 : 0) + (b === t0 ? 1 : 0);
      const err = Math.abs(a * P - b) / b;
      if (!best || prefer > best.prefer || (prefer === best.prefer && err < best.err)) {
        best = { a, b, prefer, err };
      }
    }
  }
  if (best) {
    const corrected = best.a !== q0 || best.b !== t0;
    return { quantity: best.a, totalPrice: best.b, corrected, reliable: true,
             note: corrected ? `약가 ${P} 기준 재분류` : "" };
  }

  // 3) 금액 후보 ÷ 약가 = 사용량 역산 (사용량 칸이 인접 행 값으로 통째 오염된 경우).
  //    가장 큰 후보를 금액으로 보고 역산. 소수 사용량(시럽 등)도 허용하되 검수 표시.
  const maxCand = Math.max(...cands, 0);
  if (maxCand > 0 && maxCand / P >= 0.1) {
    return { quantity: round2(maxCand / P), totalPrice: maxCand, corrected: true,
             reliable: false, note: `약가 역산 추정(검수): ${maxCand}/${P}` };
  }

  // 4) 어떤 관계도 못 맞춤 → Gemini 값 유지 + 검수
  return { quantity: q0, totalPrice: t0, corrected: false, reliable: false,
           note: "사용량·금액 관계 불일치 — 검수" };
}

// 가중치: masterMatch 50 / prefixMatch 15 / priceMatch 20 / revenueMatch 15. 합 100.
// applicable=false 인 check 는 분모에서 제외 → 옛 데이터도 자연스럽게 평가됨.
const WEIGHTS = {
  masterMatch: 50,
  prefixMatch: 15,
  priceMatch: 20,
  revenueMatch: 15,
} as const;

export function computeRowQuality(opts: {
  matchedMedicationId: string | null;
  codeOk: boolean;             // 보험코드 9자리 마스터 매칭됨
  nameSimilar: boolean;        // 마스터 매칭됐고 이름 sanity check 통과
  masterProductName: string;   // 마스터 매칭된 제품명 (mismatch 알림용)
  ocrProductName: string;
  quantity: number;
  geminiUnitPrice: number | undefined;
  masterUnitPrice: number | null;
  geminiTotalPrice: number | undefined;
  finalUnitPrice: number | null;  // 행별 단가 결정값 (마스터 > Gemini > null)
}): { checks: RowQualityChecks; score: RowScoreResult } {
  const masterResult = checkMasterMatch(opts.matchedMedicationId, opts.codeOk, opts.nameSimilar);
  const prefixCheck = checkPrefixMatch(opts.masterProductName, opts.ocrProductName);
  const priceCheck = checkPriceMatch(opts.geminiUnitPrice, opts.masterUnitPrice);
  // revenue 는 Gemini 가 reported totalPrice 와 행의 최종 단가(보통 마스터)·수량으로 검증.
  const revenueCheck = checkRevenueMatch(
    opts.quantity,
    opts.finalUnitPrice ?? opts.geminiUnitPrice ?? 0,
    opts.geminiTotalPrice ?? 0,
  );

  const checks: RowQualityChecks = {
    masterMatch: masterResult.check,
    prefixMatch: prefixCheck,
    priceMatch: priceCheck,
    revenueMatch: revenueCheck,
  };

  // 가중 평균: matched check 점수 합 / applicable check 가중치 합 × 100
  let totalWeight = 0;
  let earnedWeight = 0;
  let applicableCount = 0;
  let matchedCount = 0;

  // masterMatch 는 항상 applicable (없으면 0점)
  totalWeight += WEIGHTS.masterMatch;
  earnedWeight += masterResult.score;
  applicableCount += 1;
  if (masterResult.check.matched) matchedCount += 1;

  for (const [k, c] of [
    ["prefixMatch", prefixCheck],
    ["priceMatch", priceCheck],
    ["revenueMatch", revenueCheck],
  ] as const) {
    if (!c.applicable) continue;
    applicableCount += 1;
    if (c.matched) matchedCount += 1;
    totalWeight += WEIGHTS[k];
    if (c.matched) earnedWeight += WEIGHTS[k];
  }

  const overall = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
  return {
    checks,
    score: {
      overall,
      matchedAll: applicableCount === matchedCount,
      applicableCount,
      matchedCount,
    },
  };
}
