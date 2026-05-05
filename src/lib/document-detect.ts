// 종이 4코너 자동 감지 (OpenCV.js 사용).
// 알고리즘: grayscale → Gaussian blur → Canny edge → 큰 윤곽선 중 4점 다각형 → TL/TR/BR/BL 정렬.

import { loadOpenCV } from "./opencv-loader";

export interface DetectedCorner { x: number; y: number } // normalized 0-1
export type DetectedCorners = [DetectedCorner, DetectedCorner, DetectedCorner, DetectedCorner];

interface Cv2dPoint { x: number; y: number }

interface CvMat {
  rows: number; cols: number;
  data32S: Int32Array;
  delete(): void;
}
interface CvMatVector {
  size(): number;
  get(i: number): CvMat;
  delete(): void;
}
interface CvSize { new (w: number, h: number): unknown }
interface CvNamespace {
  Mat: { new (): CvMat };
  MatVector: { new (): CvMatVector };
  Size: CvSize;
  imread(el: HTMLImageElement | HTMLCanvasElement): CvMat;
  cvtColor(src: CvMat, dst: CvMat, code: number): void;
  GaussianBlur(src: CvMat, dst: CvMat, ksize: unknown, sigmaX: number): void;
  Canny(src: CvMat, dst: CvMat, t1: number, t2: number): void;
  findContours(src: CvMat, contours: CvMatVector, hier: CvMat, mode: number, method: number): void;
  contourArea(contour: CvMat): number;
  arcLength(contour: CvMat, closed: boolean): number;
  approxPolyDP(contour: CvMat, dst: CvMat, eps: number, closed: boolean): void;
  COLOR_RGBA2GRAY: number;
  RETR_LIST: number;
  CHAIN_APPROX_SIMPLE: number;
}

export async function detectDocumentCorners(
  imgEl: HTMLImageElement,
): Promise<DetectedCorners | null> {
  const cv = (await loadOpenCV()) as CvNamespace;
  const ow = imgEl.naturalWidth;
  const oh = imgEl.naturalHeight;

  // 다운스케일 — cv.imread + Canny + findContours 가 메인 스레드 동기 실행이라
  // 4000-6000px 스마트폰 사진은 모달이 수 초간 freeze 됨. 1000px 면 4코너
  // 감지에 충분.
  const MAX_DIM = 1000;
  const scale = Math.min(1, MAX_DIM / Math.max(ow, oh));
  let workSource: HTMLImageElement | HTMLCanvasElement = imgEl;
  let w = ow, h = oh;
  if (scale < 1) {
    const small = document.createElement("canvas");
    small.width = Math.round(ow * scale);
    small.height = Math.round(oh * scale);
    const ctx = small.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(imgEl, 0, 0, small.width, small.height);
    workSource = small;
    w = small.width; h = small.height;
  }

  const src = cv.imread(workSource as HTMLImageElement);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const ksize = new cv.Size(5, 5) as unknown as CvMat; // OpenCV.js Size accepts width/height ctor
    cv.GaussianBlur(gray, blurred, ksize, 0);
    cv.Canny(blurred, edges, 75, 200);
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const minArea = w * h * 0.1; // 전체 면적의 10% 이상만 고려
    let bestPts: Cv2dPoint[] | null = null;
    let bestArea = 0;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area < minArea) { contour.delete(); continue; }
      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * peri, true);
      if (approx.rows === 4 && area > bestArea) {
        bestArea = area;
        bestPts = [];
        for (let j = 0; j < 4; j++) {
          bestPts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
        }
      }
      approx.delete();
      contour.delete();
    }

    if (!bestPts) return null;

    // 코너 정렬: TL/TR/BR/BL
    const ordered = orderCorners(bestPts);
    return [
      { x: ordered[0].x / w, y: ordered[0].y / h },
      { x: ordered[1].x / w, y: ordered[1].y / h },
      { x: ordered[2].x / w, y: ordered[2].y / h },
      { x: ordered[3].x / w, y: ordered[3].y / h },
    ];
  } catch (e) {
    console.warn("[detectDocumentCorners] error", e);
    return null;
  } finally {
    src.delete(); gray.delete(); blurred.delete(); edges.delete();
    contours.delete(); hierarchy.delete();
  }
}

// pts 4개를 TL, TR, BR, BL 순서로 정렬.
function orderCorners(pts: Cv2dPoint[]): Cv2dPoint[] {
  const sums = pts.map((p) => p.x + p.y);
  const diffs = pts.map((p) => p.y - p.x);
  const tl = pts[sums.indexOf(Math.min(...sums))];
  const br = pts[sums.indexOf(Math.max(...sums))];
  const tr = pts[diffs.indexOf(Math.min(...diffs))];
  const bl = pts[diffs.indexOf(Math.max(...diffs))];
  return [tl, tr, br, bl];
}
