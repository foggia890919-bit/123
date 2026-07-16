// Gemini + 클로바 이중 판독(dual-read) 교차검증 + 좌표 교체.
//
// 흐름: Gemini 가 낸 행(RxDrugRow) 마다 보험코드(9자리)를 클로바 단어 목록에서 찾아 "행 앵커"로
//   삼고, 같은 높이대(사진 기울기 감안)의 클로바 숫자 단어들을 수량/단가/금액 후보로 본다.
//   Gemini 숫자와 대조해:
//     · 모두 일치            → "agree"        (신뢰 상승, 좌표만 클로바로 교체)
//     · 불일치 → 산술검산(단가×수량=금액) + 공식약가 검산을 양쪽 값으로 각각 돌려
//                통과하는 쪽 채택 → "clova-adopted"(클로바 값 반영) / "gemini-kept"(Gemini 유지)
//                둘 다 실패 → 값은 Gemini 유지하되 detail 에 양쪽 값 병기 (rowStatus 는 mismatch)
//     · 클로바에서 행을 못 찾음 → "gemini-only" (기존 Gemini 단독 결과 유지)
//   좌표: 앵커/수량 단어의 픽셀 좌표를 0~1 로 정규화해 행 bbox·qtyBbox 를 덮어쓴다
//   (클로바 좌표가 있으면 Gemini/스냅값보다 우선).
//
// 순수 함수. verifyRxRow(rx-verify) 의 검산을 재사용해 어느 쪽이 맞는지 판정한다.

import { verifyRxRow } from "./rx-verify";
import type { ClovaOcrResult, ClovaWord } from "./ai/clova-ocr";

export type DualReadTag = "agree" | "clova-adopted" | "gemini-kept" | "gemini-only";

export interface DualReadInfo {
  tag: DualReadTag;
  detail: string; // 사람이 읽을 근거 (채택 사유 / 양쪽 값 병기 등)
}

// dual-read 대상 행의 최소 형태 (RxDrugRow 호환).
export interface DualReadRow {
  code: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  bbox: [number, number, number, number];
  qtyBbox: [number, number, number, number] | null;
}

export interface DualReadStats {
  clovaWords: number;
  matched: number; // 클로바에서 행 앵커를 찾은 행 수
  agree: number;
  adopted: number;
  geminiKept: number;
  geminiOnly: number;
  coordsReplaced: number; // 클로바 좌표로 bbox 를 덮어쓴 행 수
  clovaMs: number;
}

export interface DualReadResult<T extends DualReadRow> {
  drugs: T[]; // 값·좌표가 보정된 새 배열 (원본 얕은 복제)
  infos: DualReadInfo[]; // drugs 와 같은 인덱스
  lockedIndices: Set<number>; // 클로바 좌표로 고정된 행 (bbox-regularize 가 건드리지 않도록)
  stats: DualReadStats;
}

// 행 앵커와 같은 행으로 볼 세로 허용치 = 앵커 글자높이의 이 비율.
const ROW_BAND_FRAC = 0.6;
// 수량 열 x 매칭 허용치 = 이미지 폭의 이 비율.
const QTY_X_TOL_FRAC = 0.18;

// 콤마·단위·공백 제거 후 순수 숫자 파싱. 숫자가 아니면 null.
function parseNum(text: string): number | null {
  const core = (text || "").replace(/[^\d.]/g, "");
  if (!core || !/^\d+(\.\d+)?$/.test(core)) return null;
  const n = Number(core);
  return Number.isFinite(n) ? n : null;
}

function digits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

// 두 숫자가 사실상 같은가 (콤마·반올림 수준 오차 흡수).
function numEq(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(a) * 0.001);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// 보험코드(9자리)를 클로바 단어에서 찾아 앵커 반환. 단일 단어 매칭 → 실패 시 인접 단어 연결 매칭.
function findAnchor(words: ClovaWord[], code: string): ClovaWord | null {
  if (code.length !== 9) return null;
  // 1) 단어 하나의 숫자열이 코드와 정확히 같거나 코드를 포함.
  let best: ClovaWord | null = null;
  for (const w of words) {
    const d = digits(w.text);
    if (d === code) return w; // 정확 일치 최우선
    if (!best && d.length >= 9 && d.includes(code)) best = w;
  }
  if (best) return best;
  // 2) 인접(가까운 x, 같은 y대) 단어 2~3개 숫자열 연결이 코드를 포함하면 그 중 첫 단어를 앵커로.
  const numeric = words
    .filter((w) => digits(w.text).length > 0)
    .sort((a, b) => a.yCenter - b.yCenter || a.xCenter - b.xCenter);
  for (let i = 0; i < numeric.length; i++) {
    let concat = digits(numeric[i].text);
    for (let j = i + 1; j < numeric.length && j <= i + 3; j++) {
      const near =
        Math.abs(numeric[j].yCenter - numeric[i].yCenter) <= numeric[i].height * 0.8;
      if (!near) break;
      concat += digits(numeric[j].text);
      if (concat.includes(code)) return numeric[i];
      if (concat.length > 14) break;
    }
  }
  return null;
}

// 앵커와 같은 행(높이대)에 있는 단어들 — 앵커 상단 모서리 기울기로 사진 기울임 보정.
function wordsInRow(words: ClovaWord[], anchor: ClovaWord): ClovaWord[] {
  const v = anchor.vertices;
  // vertices 순서: [top-left, top-right, bottom-right, bottom-left]
  const dx = v[1].x - v[0].x;
  const dy = v[1].y - v[0].y;
  const slope = Math.abs(dx) > 1 ? dy / dx : 0;
  const tol = Math.max(anchor.height * ROW_BAND_FRAC, 4);
  return words.filter((w) => {
    const predY = anchor.yCenter + slope * (w.xCenter - anchor.xCenter);
    return Math.abs(w.yCenter - predY) <= tol;
  });
}

// 상태 우선순위 (검산 통과 판정용). verified > mismatch > unreadable.
function statusRank(s: "verified" | "mismatch" | "unreadable"): number {
  return s === "verified" ? 2 : s === "mismatch" ? 1 : 0;
}

interface Triple {
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
}

function verifyTriple(t: Triple, code: string, masterUnitPrice: number | null) {
  return verifyRxRow({
    quantity: t.quantity,
    unitPrice: t.unitPrice,
    totalPrice: t.totalPrice,
    insuranceCode: code,
    productName: "x", // productName 판독불가는 여기 관심사 아님 — 더미로 채워 unreadable 오분류 방지
    masterUnitPrice,
  });
}

// 한 행 처리: 클로바 후보로 값 교차검증/채택 + 좌표 반환.
function processRow(
  row: DualReadRow,
  clova: ClovaOcrResult,
  masterUnitPrice: number | null,
): {
  info: DualReadInfo;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  bbox: [number, number, number, number] | null; // null = 좌표 교체 안 함
  qtyBbox: [number, number, number, number] | null | undefined; // undefined = 기존 유지
} {
  const code = digits(row.code);
  const noop = {
    info: { tag: "gemini-only" as DualReadTag, detail: "" },
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    totalPrice: row.totalPrice,
    bbox: null,
    qtyBbox: undefined,
  };
  if (code.length !== 9) return noop;

  const anchor = findAnchor(clova.words, code);
  if (!anchor) return noop;

  const rowWords = wordsInRow(clova.words, anchor);
  // 앵커(코드) 자신·코드와 같은 숫자열은 후보에서 제외.
  const numTokens = rowWords
    .filter((w) => w !== anchor && digits(w.text) !== code)
    .map((w) => ({ w, n: parseNum(w.text) }))
    .filter((x): x is { w: ClovaWord; n: number } => x.n !== null)
    .sort((a, b) => a.w.xCenter - b.w.xCenter);
  const rowNumbers = numTokens.map((x) => x.n);

  const W = clova.imageWidth;
  const H = clova.imageHeight;

  // ── 좌표: 행 bbox(행 전체 단어의 x/y 범위) ──
  const bbox: [number, number, number, number] = [
    clamp01(Math.min(anchor.xMin, ...rowWords.map((w) => w.xMin)) / W),
    clamp01(Math.min(...rowWords.map((w) => w.yMin)) / H),
    clamp01(Math.max(...rowWords.map((w) => w.xMax)) / W),
    clamp01(Math.max(...rowWords.map((w) => w.yMax)) / H),
  ];

  // ── 수량 후보(positional): Gemini qtyBbox 의 x 중심에 가장 가까운 클로바 숫자 단어 ──
  let clovaQty: number | null = null;
  let qtyBbox: [number, number, number, number] | null | undefined = undefined;
  if (row.qtyBbox && numTokens.length > 0) {
    const targetX = ((row.qtyBbox[0] + row.qtyBbox[2]) / 2) * W;
    let bestTok = numTokens[0];
    let bestDist = Math.abs(bestTok.w.xCenter - targetX);
    for (const tok of numTokens) {
      const d = Math.abs(tok.w.xCenter - targetX);
      if (d < bestDist) {
        bestDist = d;
        bestTok = tok;
      }
    }
    if (bestDist <= W * QTY_X_TOL_FRAC) {
      clovaQty = bestTok.n;
      qtyBbox = [
        clamp01(bestTok.w.xMin / W),
        clamp01(bestTok.w.yMin / H),
        clamp01(bestTok.w.xMax / W),
        clamp01(bestTok.w.yMax / H),
      ];
    }
  }
  // qtyBbox 를 못 잡았으면 앵커 행 y범위 안의 수량열 위치는 알 수 없음 → 기존 유지(undefined).

  // ── 값 교차검증 + 채택 ──
  const inRow = (v: number | null) => v !== null && rowNumbers.some((n) => numEq(n, v));

  const working: Triple = {
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    totalPrice: row.totalPrice,
  };
  const adoptions: string[] = [];
  const disagreements: string[] = [];

  // 후보 스왑 정의: [필드, 클로바 후보값, 라벨]
  type Field = "quantity" | "unitPrice" | "totalPrice";
  const proposals: { field: Field; candidate: number; label: string }[] = [];

  // 수량: positional 후보가 Gemini 값과 다르면 스왑 후보.
  if (clovaQty !== null && (row.quantity === null || !numEq(clovaQty, row.quantity))) {
    proposals.push({ field: "quantity", candidate: clovaQty, label: "수량" });
  }
  // 단가: 공식약가와 같은 클로바 숫자가 있는데 Gemini 단가가 다르면 그 값으로 스왑 후보.
  if (masterUnitPrice !== null && masterUnitPrice > 0) {
    const hit = rowNumbers.find((n) => numEq(n, masterUnitPrice));
    if (hit !== undefined && (row.unitPrice === null || !numEq(hit, row.unitPrice))) {
      proposals.push({ field: "unitPrice", candidate: hit, label: "단가" });
    }
  }
  // 금액: (현재 단가×수량) 에 맞는 클로바 숫자가 있는데 Gemini 금액이 다르면 스왑 후보.
  {
    const q = working.quantity;
    const u = working.unitPrice;
    if (q !== null && u !== null) {
      const expect = q * u;
      const hit = rowNumbers.find((n) => numEq(n, expect));
      if (hit !== undefined && (row.totalPrice === null || !numEq(hit, row.totalPrice))) {
        proposals.push({ field: "totalPrice", candidate: hit, label: "금액" });
      }
    }
  }

  // 불일치 존재 여부(값이 양쪽 다 있는데 클로바 행에 Gemini 값이 안 보임) 기록 — agree 판정용.
  for (const [label, val] of [
    ["수량", row.quantity],
    ["단가", row.unitPrice],
    ["금액", row.totalPrice],
  ] as [string, number | null][]) {
    if (val !== null && rowNumbers.length > 0 && !inRow(val)) disagreements.push(label);
  }

  // 그리디 채택: 필드 순서대로, 스왑이 검산을 개선하면 반영.
  for (const p of proposals) {
    const before = verifyTriple(working, code, masterUnitPrice);
    const swapped: Triple = { ...working, [p.field]: p.candidate };
    const after = verifyTriple(swapped, code, masterUnitPrice);
    const geminiVal = row[p.field];

    // null 채우기는 산술검산(checkA)이 실제로 통과할 때만 (환각 방지).
    const isFill = geminiVal === null;
    const improves =
      statusRank(after.status) > statusRank(before.status) ||
      (after.checkA.applicable && after.checkA.pass && !(before.checkA.applicable && before.checkA.pass));

    if (improves && (!isFill || (after.checkA.applicable && after.checkA.pass))) {
      const fromTxt = geminiVal === null ? "(판독불가)" : geminiVal.toLocaleString();
      adoptions.push(`${p.label} ${fromTxt} → 클로바 ${p.candidate.toLocaleString()}`);
      working[p.field] = p.candidate;
    }
  }

  // ── 태그 판정 ──
  let info: DualReadInfo;
  if (adoptions.length > 0) {
    info = { tag: "clova-adopted", detail: `클로바 채택: ${adoptions.join(", ")}` };
  } else if (disagreements.length === 0) {
    info = { tag: "agree", detail: "클로바 교차검증 일치" };
  } else {
    // 불일치했으나 채택 없음. 최종 검산이 통과하면 Gemini 가 맞은 것, 아니면 양쪽 값 병기.
    const finalV = verifyTriple(working, code, masterUnitPrice);
    if (finalV.status === "verified") {
      info = { tag: "gemini-kept", detail: `Gemini 값 유지 (검산 통과, 클로바 불일치: ${disagreements.join(",")})` };
    } else {
      const both: string[] = [];
      for (const [label, gv, key] of [
        ["수량", row.quantity, "quantity"],
        ["단가", row.unitPrice, "unitPrice"],
        ["금액", row.totalPrice, "totalPrice"],
      ] as [string, number | null, keyof Triple][]) {
        if (!disagreements.includes(label)) continue;
        // 그 열에서 Gemini 와 다른 클로바 숫자 하나를 참고로 병기.
        const alt = rowNumbers.find((n) => gv === null || !numEq(n, gv));
        both.push(`${label} Gemini ${gv === null ? "판독불가" : gv.toLocaleString()}${alt !== undefined ? ` / 클로바 ${alt.toLocaleString()}` : ""}`);
      }
      info = { tag: "gemini-kept", detail: `양쪽 검산 실패 — ${both.join("; ")}` };
    }
  }

  return {
    info,
    quantity: working.quantity,
    unitPrice: working.unitPrice,
    totalPrice: working.totalPrice,
    bbox,
    qtyBbox,
  };
}

export function dualRead<T extends DualReadRow>(
  drugs: T[],
  clova: ClovaOcrResult,
  masterUnitPriceByCode: Map<string, number | null>,
): DualReadResult<T> {
  const infos: DualReadInfo[] = [];
  const lockedIndices = new Set<number>();
  const stats: DualReadStats = {
    clovaWords: clova.words.length,
    matched: 0,
    agree: 0,
    adopted: 0,
    geminiKept: 0,
    geminiOnly: 0,
    coordsReplaced: 0,
    clovaMs: clova.durationMs,
  };

  const out = drugs.map((row, i) => {
    const master = masterUnitPriceByCode.get(digits(row.code)) ?? null;
    const r = processRow(row, clova, master);
    infos[i] = r.info;

    switch (r.info.tag) {
      case "agree":
        stats.agree++;
        stats.matched++;
        break;
      case "clova-adopted":
        stats.adopted++;
        stats.matched++;
        break;
      case "gemini-kept":
        stats.geminiKept++;
        stats.matched++;
        break;
      case "gemini-only":
        stats.geminiOnly++;
        break;
    }

    const next: T = { ...row, quantity: r.quantity, unitPrice: r.unitPrice, totalPrice: r.totalPrice };
    if (r.bbox) {
      next.bbox = r.bbox;
      if (r.qtyBbox !== undefined) next.qtyBbox = r.qtyBbox;
      lockedIndices.add(i);
      stats.coordsReplaced++;
    }
    return next;
  });

  return { drugs: out, infos, lockedIndices, stats };
}
