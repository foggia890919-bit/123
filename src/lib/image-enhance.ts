// 이미지 후공정 파이프라인 (OpenCV.js 기반).
//
// perspective 보정 직후 이 함수에 canvas 를 넘기면 다음 단계가 적용된 새 canvas 반환:
//   1. Upscale to 2400px (cubic interp) — 작은 이미지 detail 보존
//   2. CLAHE (Lab L 채널) — 부분별 명암 자동 보정, 그림자 흡수
//   3. Bilateral filter — 글자 엣지 보존하며 노이즈 제거
//   4. Unsharp mask — 글자 가독성 향상
//
// 모든 OCR 엔진에 공통으로 도움이 됨. 처방전 같은 한국어 정형 문서에서
// 정확도 5-10% 향상 기대.

import { loadOpenCV } from "./opencv-loader";

// 1800px 면 OCR 엔진들에 충분하면서 main-thread freeze 회피.
// 2400px 로 가면 bilateral filter 가 5초 이상 걸려서 사용자 freeze 체감.
const TARGET_DIM = 1800;

// 타입 안전성보다 OpenCV 호출 편의를 우선 — Mat/Vector 등은 동적
type CvAny = any;  // eslint-disable-line @typescript-eslint/no-explicit-any

export interface EnhanceOptions {
  /** 원본보다 작아진 이미지를 이 dimension 까지 cubic 으로 upscale (default 2400) */
  targetDim?: number;
  /** CLAHE clipLimit (default 3.0). 너무 높으면 노이즈 증폭 */
  claheClipLimit?: number;
  /** CLAHE tile 크기 (default 8) */
  claheTileSize?: number;
  /** Bilateral filter 강도 (default 9, 높을수록 강한 denoise) */
  bilateralD?: number;
  /** Sharpen 강도 (default 0.5). 0 이면 sharpen 안 함 */
  sharpenAmount?: number;
}

export async function enhanceImage(
  inputCanvas: HTMLCanvasElement,
  opts: EnhanceOptions = {},
): Promise<HTMLCanvasElement> {
  const {
    targetDim = TARGET_DIM,
    claheClipLimit = 3.0,
    claheTileSize = 8,
    bilateralD = 5,
    sharpenAmount = 0.5,
  } = opts;

  // 1. Upscale (Canvas API — fast, smooth quality)
  let working = inputCanvas;
  const maxDim = Math.max(inputCanvas.width, inputCanvas.height);
  if (maxDim < targetDim) {
    const scale = targetDim / maxDim;
    const up = document.createElement("canvas");
    up.width = Math.round(inputCanvas.width * scale);
    up.height = Math.round(inputCanvas.height * scale);
    const ctx = up.getContext("2d");
    if (!ctx) throw new Error("upscale ctx fail");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(inputCanvas, 0, 0, up.width, up.height);
    working = up;
  }

  // 2. OpenCV pipeline
  const cv = (await loadOpenCV()) as CvAny;
  const src: CvAny = cv.imread(working);
  const lab: CvAny = new cv.Mat();
  const channels: CvAny = new cv.MatVector();
  const lEnhanced: CvAny = new cv.Mat();
  const labEnhanced: CvAny = new cv.Mat();
  const rgb: CvAny = new cv.Mat();
  const denoised: CvAny = new cv.Mat();
  const sharpened: CvAny = new cv.Mat();

  try {
    // BGR (OpenCV) → Lab. CLAHE 는 L 채널에만 적용해서 색상 왜곡 방지
    cv.cvtColor(src, lab, cv.COLOR_RGBA2RGB);
    cv.cvtColor(lab, lab, cv.COLOR_RGB2Lab);
    cv.split(lab, channels);

    // CLAHE on L channel — 부분별 명암 보정
    const clahe: CvAny = new cv.CLAHE(claheClipLimit, new cv.Size(claheTileSize, claheTileSize));
    clahe.apply(channels.get(0), lEnhanced);
    clahe.delete();

    // 채널 재조립
    const newChannels: CvAny = new cv.MatVector();
    newChannels.push_back(lEnhanced);
    newChannels.push_back(channels.get(1));
    newChannels.push_back(channels.get(2));
    cv.merge(newChannels, labEnhanced);
    newChannels.delete();

    cv.cvtColor(labEnhanced, rgb, cv.COLOR_Lab2RGB);

    // Bilateral filter — 글자 엣지 보존하며 노이즈 제거
    cv.bilateralFilter(rgb, denoised, bilateralD, 75, 75);

    // Unsharp mask — sharpenAmount 만큼 글자 강조
    if (sharpenAmount > 0) {
      const blurred: CvAny = new cv.Mat();
      cv.GaussianBlur(denoised, blurred, new cv.Size(0, 0), 1.5);
      cv.addWeighted(denoised, 1 + sharpenAmount, blurred, -sharpenAmount, 0, sharpened);
      blurred.delete();
    } else {
      denoised.copyTo(sharpened);
    }

    // 결과를 canvas 로 (RGBA)
    const out = document.createElement("canvas");
    out.width = working.width;
    out.height = working.height;
    cv.imshow(out, sharpened);
    return out;
  } finally {
    src.delete(); lab.delete(); channels.delete();
    lEnhanced.delete(); labEnhanced.delete();
    rgb.delete(); denoised.delete(); sharpened.delete();
  }
}
