// 서버단 자동 이미지 전처리 — Gemini/클로바 OCR 호출 직전에 사진을 자동 보정.
//
// 목적: 사용자가 프런트(캠스캐너) 보정을 건너뛰어도 서버가 기울어짐/회전을 자동 교정한
//       이미지를 OCR 에 전달. 특히 "옆으로 누운(sideways) 사진"(유형 26)에서 Gemini 가
//       표 구조를 잘못 읽어 행이 밀리는 문제를 완화한다.
//
// 설계 원칙:
//  - 안전 폴백 최우선: 어떤 단계든 실패하면 절대 throw 하지 않고 원본을 그대로 반환.
//  - 우선순위: 회전 보정 >> 원근 펴기. 원근 펴기는 opencv-wasm(대형 WASM, cold-start·번들 250MB
//    한도 부담)이 필요해 이번 구현에서는 제외하고, 회전 보정만 확실히 수행한다. (warped 는 항상 false)
//  - EXIF Orientation 은 sharp .rotate() 로 자동 반영.
//  - 콘텐츠 회전 감지는 그레이스케일 축소본의 행/열 투영 분산으로 텍스트 방향(가로/세로)을 판별.
//
// 런타임: Vercel Node 서버리스. sharp(0.34.x) 만 사용 — Vercel 공식 지원, 네이티브 의존성 문제 없음.

import sharp from "sharp";

export interface PreprocessResult {
  /** 보정된 이미지 base64 (변경 없으면 원본 그대로) */
  base64: string;
  /** 보정 후 mimeType. 재인코딩 시 image/jpeg, 변경 없으면 원본 mime */
  mimeType: string;
  /** 실제로 픽셀이 바뀌었는지 (EXIF 반영 또는 회전 발생) */
  applied: boolean;
  /** 콘텐츠 회전 보정 각도 (시계방향). EXIF 보정은 여기 포함 안 됨 */
  rotated: 0 | 90 | 270;
  /** 원근 펴기 적용 여부 (이번 구현에서는 항상 false) */
  warped: boolean;
  /** 전처리 소요시간(ms) */
  ms: number;
}

// 감지 축소본 목표 크기(긴 변 픽셀). 너무 크면 느리고, 너무 작으면 텍스트 줄 구조가 뭉개짐.
const DETECT_MAX_SIDE = 1000;
// 세로/가로 투영 분산 비율이 이 값을 넘으면 "텍스트가 세로로 누웠다"고 판단 → 90/270 회전 후보.
const AXIS_DOMINANCE = 1.30;
// 90 vs 270 판별용 — 짙은 콘텐츠(제목/헤더) 무게중심이 좌/우로 이 비율(중심 0.5 기준) 이상
// 치우쳐야 폴라리티 확정. 미달이면 안전하게 원본 유지.
const SIDE_MARGIN = 0.03;

/** 배열의 표본분산 */
function variance(arr: number[]): number {
  const n = arr.length;
  if (n === 0) return 0;
  let mean = 0;
  for (const v of arr) mean += v;
  mean /= n;
  let s = 0;
  for (const v of arr) {
    const d = v - mean;
    s += d * d;
  }
  return s / n;
}

/**
 * EXIF 보정된 그레이스케일 축소본에서 콘텐츠 회전각(0/90/270, 시계방향)을 추정.
 * 애매하면 0 을 반환(원본 유지)한다.
 */
async function detectRotation(buf: Buffer): Promise<0 | 90 | 270> {
  // EXIF 반영 후 그레이스케일 축소. failOn:"none" 으로 손상 이미지도 최대한 디코드.
  const { data, info } = await sharp(buf, { failOn: "none" })
    .rotate() // EXIF Orientation 자동 반영 (감지도 보정된 픽셀 기준)
    .grayscale()
    .resize(DETECT_MAX_SIDE, DETECT_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const ch = info.channels; // grayscale 여도 sharp 는 채널 수가 1 이상일 수 있음 → 채널 0 만 사용
  if (w < 8 || h < 8) return 0;

  // 행 평균 밝기 / 열 평균 밝기 프로파일.
  const rowMean = new Float64Array(h);
  const colMean = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const base = y * w * ch;
    for (let x = 0; x < w; x++) {
      const v = data[base + x * ch];
      rowSum += v;
      colMean[x] += v;
    }
    rowMean[y] = rowSum / w;
  }
  for (let x = 0; x < w; x++) colMean[x] /= h;

  const rowVar = variance(Array.from(rowMean));
  const colVar = variance(Array.from(colMean));

  // 텍스트가 가로줄이면 인접 행이 글자/여백으로 교대 → rowVar 큼(=정방향).
  // 세로로 누웠으면 colVar 가 큼 → 90/270 회전 필요.
  if (rowVar <= 0 && colVar <= 0) return 0;
  const ratio = colVar / Math.max(rowVar, 1e-6);
  if (ratio < AXIS_DOMINANCE) return 0; // 이미 가로(정방향)이거나 애매 → 원본 유지

  // ── 세로로 누움 확정 → 90 vs 270 판별 ──
  // 투영 "분산"은 90/270 이 수학적으로 동일(프로파일이 상하 반전이라 분산 불변)이라
  // 폴라리티(어느 쪽이 원래 위였나)는 분산으로 못 가른다. 문서의 "위쪽" 비대칭 단서를 쓴다:
  // 처방통계/문서는 상단에 제목·표 헤더(짙은 밴드)가 있어 잉크 농도가 위로 쏠린다.
  // 세로 이미지에서 원본 "위쪽"은 좌/우 세로 밴드로 이동해 있으므로, 짙은 열의 무게중심(comX)이
  // 우측이면 "우측이 위" → rotate(270), 좌측이면 "좌측이 위" → rotate(90). (sharp 는 시계방향)
  // (리딩 여백 비대칭도 시도했으나 표 본문 대비 신호가 약하고 상/하단 여백 크기가 뒤집히면
  //  오히려 방향을 반전시켜, 헤더 농도 무게중심 단서만 사용한다.)
  let darkSum = 0;
  let darkWeighted = 0;
  for (let x = 0; x < w; x++) {
    const d = 255 - colMean[x];
    darkSum += d;
    darkWeighted += d * x;
  }
  if (darkSum <= 1e-6) return 0;
  const comBias = darkWeighted / darkSum / w - 0.5; // >0 이면 농도가 우측 → 우측이 위
  if (Math.abs(comBias) < SIDE_MARGIN) return 0; // 좌우 확신 부족 → 안전하게 원본 유지
  return comBias < 0 ? 90 : 270;
}

/**
 * 이미지 자동 전처리. 실패 시 원본을 그대로 반환(never throws).
 */
export async function preprocessImage(
  base64: string,
  mimeType: string,
): Promise<PreprocessResult> {
  const t0 = Date.now();
  const fallback: PreprocessResult = {
    base64,
    mimeType,
    applied: false,
    rotated: 0,
    warped: false,
    ms: 0,
  };

  try {
    const input = Buffer.from(base64, "base64");
    if (input.length === 0) return { ...fallback, ms: Date.now() - t0 };

    // EXIF Orientation 값(1=정상, >1 이면 회전/반전 메타 존재).
    let exifOrientation = 1;
    try {
      const meta = await sharp(input, { failOn: "none" }).metadata();
      exifOrientation = meta.orientation ?? 1;
    } catch {
      // 메타 실패해도 계속 (rotate() 가 알아서 처리)
    }

    const angle = await detectRotation(input);
    const exifApplied = exifOrientation > 1;

    // 픽셀 변경이 없으면(회전 각 0 && EXIF 정상) 재인코딩 없이 원본 반환 — 응답 크기·연산 절약.
    if (angle === 0 && !exifApplied) {
      return { ...fallback, ms: Date.now() - t0 };
    }

    // 실제 보정본 생성: EXIF 반영 → 콘텐츠 회전 → JPEG 재인코딩.
    let pipeline = sharp(input, { failOn: "none" }).rotate(); // EXIF 반영
    if (angle !== 0) pipeline = pipeline.rotate(angle); // 콘텐츠 회전(시계방향)
    const out = await pipeline.jpeg({ quality: 90 }).toBuffer();

    return {
      base64: out.toString("base64"),
      mimeType: "image/jpeg",
      applied: true,
      rotated: angle,
      warped: false,
      ms: Date.now() - t0,
    };
  } catch {
    // 어떤 실패든 원본 그대로 (안전 폴백)
    return { ...fallback, ms: Date.now() - t0 };
  }
}
