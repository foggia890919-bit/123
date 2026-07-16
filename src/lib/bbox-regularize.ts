// bbox 정규화(스냅) — Gemini 가 행별로 내는 bbox/qtyBbox 좌표의 행 단위 흔들림 보정.
//
// 왜: 촘촘한 표에서 모델이 내는 y좌표가 행마다 조금씩 흔들려 하이라이트가 옆 행을
//     물거나 두 행에 걸친다. 실제 표는 (거의) 등간격 격자이므로, 모델 좌표에서 격자를
//     추정한 뒤 각 행을 그 격자에 스냅하면 흔들림이 사라진다.
//
// 입력 가정:
//   - rows[i].bbox = [x1, y1, x2, y2], 각 값 0~1 비율. 배열 순서 = 표의 위→아래 행 순서.
//   - 유효 행 bbox = y1 < y2 (높이 > 0). [0,0,0,0] 등은 무효(모델이 위치 못 잡음).
//   - rows[i].qtyBbox = 같은 형식이거나 null(수량 판독 실패 → 위치 없음).
//   - 좌표는 이미 0~1 로 clamp 된 상태(gemini-rx-stats-extract.normalizeDrug 참조).
//
// 출력:
//   - rows 와 같은 길이의 새 배열. 각 원소는 원본을 얕게 복제하고 bbox/qtyBbox 만 덮어씀.
//   - 유효 bbox 가 3개 미만이면 아무것도 하지 않고 원본을 그대로 반환(소형 표는 스냅 불필요).
//
// 알고리즘 요지:
//   1) 세로 스냅: 행 인덱스 → y중심 을 Theil-Sen(모든 쌍의 기울기 중앙값 + 절편 중앙값)로
//      견고하게 선형 적합. 아웃라이어(한 행만 크게 튄 좌표)에 강함. 기울어진/원근 사진은
//      행 간격이 위아래로 일정하게 변하므로 선형 기울기가 이를 자연스럽게 흡수한다.
//      각 행 y중심이 적합값에서 (중앙값 행높이)의 40% 이상 벗어나면 적합값으로 교체하고,
//      행 높이는 전부 중앙값 행높이로 통일 → 등간격 격자 정렬. 격자 자체는 모델 좌표에서 유도.
//   2) 수량 열 가로 스냅: 유효 qtyBbox 의 x1,x2 중앙값을 구해 수량 열의 고정 x범위로 삼고,
//      qtyBbox 가 있던 행들의 x범위를 그 값으로 통일. y범위는 보정된 행 bbox 의 y범위에
//      약간 인셋. qtyBbox 가 null 이던 행은 그대로 null 유지(수량 판독 실패 의미 보존).

type Bbox4 = [number, number, number, number];

interface RegularizableRow {
  bbox: Bbox4;
  qtyBbox: Bbox4 | null;
}

// 세로 이탈 허용치: 중앙값 행높이의 40% 넘게 벗어난 행만 격자값으로 교체.
const OUTLIER_FRAC = 0.4;
// 수량 박스 세로 인셋: 행 높이의 이 비율만큼 위아래를 줄여 셀 안쪽에 위치.
const QTY_INSET_FRAC = 0.15;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function isValidBox(b: Bbox4 | null | undefined): b is Bbox4 {
  return (
    Array.isArray(b) &&
    b.length === 4 &&
    b.every((n) => Number.isFinite(n)) &&
    b[3] > b[1] // y1 < y2 (높이 > 0)
  );
}

// lockedIndices: 이미 신뢰할 좌표(예: 클로바 실측)로 채워진 행. 격자 적합에는 참여(좋은 앵커)
//   하지만 출력에서 스냅으로 덮어쓰지 않고 원본 좌표를 그대로 보존한다.
export function regularizeBboxes<T extends RegularizableRow>(
  rows: T[],
  lockedIndices?: Set<number>,
): T[] {
  const n = rows.length;

  // 유효 행 bbox 수집 (원본 배열 인덱스 유지 — 중간에 무효 행이 있어도 격자 슬롯은 그대로).
  const valid: { i: number; yc: number; h: number }[] = [];
  for (let i = 0; i < n; i++) {
    const b = rows[i].bbox;
    if (isValidBox(b)) {
      valid.push({ i, yc: (b[1] + b[3]) / 2, h: b[3] - b[1] });
    }
  }

  // 소형 표(유효 3개 미만)는 스냅하지 않고 원본 그대로.
  if (valid.length < 3) return rows;

  // --- 세로 스냅: Theil-Sen 선형 적합 (행 인덱스 → y중심) ---
  const slopes: number[] = [];
  for (let a = 0; a < valid.length; a++) {
    for (let b = a + 1; b < valid.length; b++) {
      const di = valid[b].i - valid[a].i;
      if (di !== 0) slopes.push((valid[b].yc - valid[a].yc) / di);
    }
  }
  const slope = median(slopes);
  const intercept = median(valid.map((v) => v.yc - slope * v.i));
  const predCenter = (i: number) => intercept + slope * i;

  // 중앙값 행높이 = 통일 행 높이. 유효 박스 높이의 중앙값.
  const medH = median(valid.map((v) => v.h));
  const halfH = medH / 2;
  const tol = OUTLIER_FRAC * medH;

  // 무효 행에 채워 넣을 기본 x범위 (유효 행 x범위의 중앙값).
  const medX1 = median(valid.map((v) => rows[v.i].bbox[0]));
  const medX2 = median(valid.map((v) => rows[v.i].bbox[2]));

  // --- 수량 열 가로 스냅: 유효 qtyBbox x범위 중앙값 ---
  const validQty = rows.map((r) => r.qtyBbox).filter(isValidBox);
  const hasQtyColumn = validQty.length > 0;
  const qtyX1 = hasQtyColumn ? median(validQty.map((q) => q[0])) : 0;
  const qtyX2 = hasQtyColumn ? median(validQty.map((q) => q[2])) : 0;
  const qtyInset = QTY_INSET_FRAC * medH;

  return rows.map((row, i) => {
    // 클로바 실측 좌표로 고정된 행은 스냅하지 않고 그대로 반환.
    if (lockedIndices?.has(i)) return row;

    const b = row.bbox;
    const pred = predCenter(i);

    // 유효 행은 격자에서 40% 이내면 모델 중심 유지, 아니면 격자값으로 교체.
    // 무효 행은 격자값 사용(위치 복원).
    let center: number;
    let x1: number;
    let x2: number;
    if (isValidBox(b)) {
      const yc = (b[1] + b[3]) / 2;
      center = Math.abs(yc - pred) > tol ? pred : yc;
      x1 = b[0];
      x2 = b[2];
    } else {
      center = pred;
      x1 = medX1;
      x2 = medX2;
    }

    const newY1 = clamp01(center - halfH);
    const newY2 = clamp01(center + halfH);
    const newBbox: Bbox4 = [clamp01(x1), newY1, clamp01(x2), newY2];

    // qtyBbox: 원래 있던 행만 보정(null 은 유지). x는 수량 열 중앙값, y는 보정된 행 y 인셋.
    let newQty: Bbox4 | null = row.qtyBbox;
    if (hasQtyColumn && isValidBox(row.qtyBbox)) {
      const qy1 = clamp01(newY1 + qtyInset);
      const qy2 = clamp01(newY2 - qtyInset);
      // 인셋으로 뒤집히면(행이 너무 얇음) 인셋 없이 행 y범위 그대로.
      newQty = qy2 > qy1
        ? [clamp01(qtyX1), qy1, clamp01(qtyX2), qy2]
        : [clamp01(qtyX1), newY1, clamp01(qtyX2), newY2];
    }

    return { ...row, bbox: newBbox, qtyBbox: newQty };
  });
}
