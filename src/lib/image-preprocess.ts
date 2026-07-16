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
//  - 90 vs 270 폴라리티는 "상단 잉크 무게중심" 추측 대신 클로바 실측 프로브로 확정한다.
//    (눕혀진 사진에서만 클로바를 최대 2회 추가 호출. 정방향 사진은 프로브 없이 추가 비용 0.)
//
// 런타임: Vercel Node 서버리스. sharp(0.34.x) 만 사용 — Vercel 공식 지원, 네이티브 의존성 문제 없음.

import sharp from "sharp";
import { readWithClova, isClovaConfigured, type ClovaOcrResult } from "./ai/clova-ocr";

/** 90/270 폴라리티를 어떻게 정했는지 응답 진단에 노출하기 위한 정보. */
export interface RotationProbe {
  /** 클로바 프로브를 실제로 수행하고 유효한 결과를 얻었는지. false 면 잉크 무게중심 휴리스틱으로 폴백. */
  used: boolean;
  /** 프로브가 채택한 회전각(시계방향). 0 = 두 방향이 비등하거나 판정 불가 → 회전 포기(원본 유지). */
  chosen: 0 | 90 | 270;
  /** 90도 회전본의 점수(단어 수 × 평균 confidence)와 근거 값. */
  score90: number;
  score270: number;
  words90: number;
  words270: number;
  conf90: number;
  conf270: number;
  /** 판정 사유 (진단용). */
  reason: string;
}

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
  /** 눕혀진 사진에서 90/270 판정에 쓴 클로바 프로브 결과. 정방향 사진이면 생략. */
  probe?: RotationProbe;
  /** 전처리 소요시간(ms) */
  ms: number;
}

// 감지 축소본 목표 크기(긴 변 픽셀). 너무 크면 느리고, 너무 작으면 텍스트 줄 구조가 뭉개짐.
const DETECT_MAX_SIDE = 1000;
// 세로/가로 투영 분산 비율이 이 값을 넘으면 "텍스트가 세로로 누웠다"고 판단 → 90/270 회전 후보.
const AXIS_DOMINANCE = 1.30;
// 잉크 무게중심 휴리스틱(클로바 폴백)용 — 짙은 콘텐츠 무게중심이 좌/우로 이 비율 이상 치우쳐야
// 폴라리티 확정. 미달이면 0(원본 유지).
const SIDE_MARGIN = 0.03;

// 클로바 프로브용 축소본 긴 변 픽셀. ~1200px 로 줄여 호출 페이로드/시간 절약.
const PROBE_MAX_SIDE = 1200;
// 프로브 클로바 호출 각각의 타임아웃(ms). 눕힌 사진에서만 최대 2회 추가되므로 짧게.
const PROBE_TIMEOUT_MS = 12_000;
// 두 방향 점수가 max 대비 이 비율 미만으로 비등하면 회전 포기(원본 유지).
const PROBE_TIE_RATIO = 0.20;

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

interface AxisDetection {
  /** 텍스트가 옆으로 누웠는지(90/270 회전 후보). */
  sideways: boolean;
  /** 잉크 무게중심 휴리스틱의 폴라리티 추정(클로바 미설정/실패 시 폴백). 애매하면 0. */
  heuristicAngle: 0 | 90 | 270;
}

/**
 * EXIF 보정된 그레이스케일 축소본에서 텍스트 축(정방향 vs 옆으로 누움)을 판별하고,
 * 누웠다면 잉크 무게중심으로 폴라리티(90/270)를 추정(폴백용)한다. 애매하면 정방향으로 간주.
 */
async function detectAxis(buf: Buffer): Promise<AxisDetection> {
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
  if (w < 8 || h < 8) return { sideways: false, heuristicAngle: 0 };

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
  if (rowVar <= 0 && colVar <= 0) return { sideways: false, heuristicAngle: 0 };
  const ratio = colVar / Math.max(rowVar, 1e-6);
  if (ratio < AXIS_DOMINANCE) return { sideways: false, heuristicAngle: 0 };

  // ── 세로로 누움 확정 → 폴라리티 휴리스틱(클로바 폴백용) ──
  // 투영 "분산"은 90/270 이 수학적으로 동일(프로파일 상하 반전이라 분산 불변)이라 폴라리티를
  // 못 가른다. 문서 상단의 제목·헤더(짙은 밴드) 잉크 농도 무게중심으로 어느 쪽이 원래 위였나 추정한다.
  // 세로 이미지에서 원본 "위쪽"은 좌/우 세로 밴드로 이동해 있으므로, 짙은 열의 무게중심(comX)이
  // 우측이면 "우측이 위" → rotate(270), 좌측이면 "좌측이 위" → rotate(90). (sharp 는 시계방향)
  // 이 휴리스틱은 실측에서 너무 보수적이라(유형 26 미회전) 클로바 프로브의 폴백으로만 남긴다.
  let heuristicAngle: 0 | 90 | 270 = 0;
  let darkSum = 0;
  let darkWeighted = 0;
  for (let x = 0; x < w; x++) {
    const d = 255 - colMean[x];
    darkSum += d;
    darkWeighted += d * x;
  }
  if (darkSum > 1e-6) {
    const comBias = darkWeighted / darkSum / w - 0.5; // >0 이면 농도가 우측 → 우측이 위
    if (Math.abs(comBias) >= SIDE_MARGIN) heuristicAngle = comBias < 0 ? 90 : 270;
  }
  return { sideways: true, heuristicAngle };
}

/** 클로바 결과를 (단어 수 × 평균 confidence) 점수로 환산. null/빈 결과면 0. */
function scoreClova(r: ClovaOcrResult | null): { words: number; conf: number; score: number } {
  if (!r || r.words.length === 0) return { words: 0, conf: 0, score: 0 };
  const words = r.words.length;
  let sum = 0;
  for (const wd of r.words) sum += wd.confidence;
  const conf = sum / words;
  return { words, conf, score: words * conf };
}

/** EXIF 반영 → 지정 각 회전 → ~1200px 축소 → JPEG base64. 실패 시 null. */
async function makeProbeJpeg(input: Buffer, angle: 90 | 270): Promise<string | null> {
  try {
    const out = await sharp(input, { failOn: "none" })
      .rotate() // EXIF 반영
      .rotate(angle) // 후보 회전(시계방향)
      .resize(PROBE_MAX_SIDE, PROBE_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return out.toString("base64");
  } catch {
    return null;
  }
}

/**
 * 눕힌 사진의 90 vs 270 을 클로바 실측으로 판정.
 * 90/270 회전본 두 장을 병렬 판독해 점수가 높은 쪽을 채택. 두 점수가 비등(20% 미만 차)하면 포기(0).
 * 축소·인코딩 실패나 두 호출 모두 실패면 used=false (호출부가 휴리스틱으로 폴백).
 */
async function probeSideways(input: Buffer): Promise<RotationProbe> {
  const failed: RotationProbe = {
    used: false,
    chosen: 0,
    score90: 0,
    score270: 0,
    words90: 0,
    words270: 0,
    conf90: 0,
    conf270: 0,
    reason: "probe_unavailable",
  };

  let j90: string | null;
  let j270: string | null;
  try {
    [j90, j270] = await Promise.all([makeProbeJpeg(input, 90), makeProbeJpeg(input, 270)]);
  } catch {
    return failed;
  }
  // 한쪽이라도 축소/인코딩 실패면 공정 비교 불가 → 휴리스틱 폴백.
  if (!j90 || !j270) return failed;

  const [r90, r270] = await Promise.all([
    readWithClova(j90, "image/jpeg", PROBE_TIMEOUT_MS),
    readWithClova(j270, "image/jpeg", PROBE_TIMEOUT_MS),
  ]);
  // 두 호출 모두 실패(env 미설정/타임아웃/인식 실패) → 휴리스틱 폴백.
  if (r90 === null && r270 === null) return failed;

  const s90 = scoreClova(r90);
  const s270 = scoreClova(r270);
  const diag = {
    used: true as const,
    score90: s90.score,
    score270: s270.score,
    words90: s90.words,
    words270: s270.words,
    conf90: s90.conf,
    conf270: s270.conf,
  };

  const hi = Math.max(s90.score, s270.score);
  const lo = Math.min(s90.score, s270.score);
  if (hi <= 0) return { ...diag, chosen: 0, reason: "clova_zero_score" };
  if ((hi - lo) / hi < PROBE_TIE_RATIO) return { ...diag, chosen: 0, reason: "tie_within_20pct" };
  return { ...diag, chosen: s90.score > s270.score ? 90 : 270, reason: "clova_probe" };
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

    const axis = await detectAxis(input);

    // 회전 각 결정. 정방향이면 0(프로브 없음). 옆으로 누웠으면 클로바 프로브로 90/270 확정,
    // 클로바 미설정/실패면 잉크 무게중심 휴리스틱으로 폴백.
    let angle: 0 | 90 | 270 = 0;
    let probe: RotationProbe | undefined;
    if (axis.sideways) {
      if (isClovaConfigured()) {
        probe = await probeSideways(input);
        angle = probe.used ? probe.chosen : axis.heuristicAngle;
      } else {
        angle = axis.heuristicAngle;
      }
    }

    const exifApplied = exifOrientation > 1;

    // 픽셀 변경이 없으면(회전 각 0 && EXIF 정상) 재인코딩 없이 원본 반환 — 응답 크기·연산 절약.
    if (angle === 0 && !exifApplied) {
      return { ...fallback, probe, ms: Date.now() - t0 };
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
      probe,
      ms: Date.now() - t0,
    };
  } catch {
    // 어떤 실패든 원본 그대로 (안전 폴백)
    return { ...fallback, ms: Date.now() - t0 };
  }
}
