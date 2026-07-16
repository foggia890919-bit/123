// 자동 문서 감지 + 회전 판별 유틸.
// DocumentScanner 의 기존 순수-canvas warp 경로와는 독립. OpenCV 는 감지에만 사용하며
// 로드/감지 실패 시 조용히 null/false 를 반환해 모달이 정상 동작하도록 한다.

export interface Point {
  x: number;
  y: number;
}
// TL, TR, BR, BL (정규화 0~1)
export type Corners = [Point, Point, Point, Point];

interface ImgSize {
  w: number;
  h: number;
}

// ─────────── (A) OpenCV.js lazy singleton 로더 ───────────

declare global {
  interface Window {
    cv?: unknown;
  }
}

let cvPromise: Promise<unknown> | null = null;

export function loadOpenCV(): Promise<unknown> {
  if (cvPromise) return cvPromise;

  cvPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("no window (SSR)"));
      return;
    }

    const w = window as Window;

    // 런타임 준비 여부 판정: cv 객체이고 Mat 생성자가 존재.
    const isReady = (cv: unknown): boolean =>
      !!cv && typeof (cv as { Mat?: unknown }).Mat === "function";

    // script.onload 이후 window.cv 상태에 따라 resolve 를 마무리.
    const settle = () => {
      const cv = w.cv as
        | { Mat?: unknown; onRuntimeInitialized?: () => void; then?: unknown }
        | undefined;
      if (!cv) {
        reject(new Error("window.cv missing after load"));
        return;
      }
      // (1) Promise 형태(신형 빌드) — await 해서 실제 모듈 획득
      if (typeof (cv as { then?: unknown }).then === "function") {
        (cv as Promise<unknown>).then(
          (real) => resolve(real),
          (err) => reject(err),
        );
        return;
      }
      // (2) 이미 Mat 준비됨
      if (isReady(cv)) {
        resolve(cv);
        return;
      }
      // (3) 런타임 초기화 콜백 대기
      cv.onRuntimeInitialized = () => resolve(cv);
    };

    // 이미 로드/준비된 경우 즉시 처리
    if (w.cv) {
      settle();
      return;
    }

    // 타임아웃 20초
    const timeout = setTimeout(() => {
      reject(new Error("opencv load timeout"));
    }, 20000);

    const finish = (fn: () => void) => {
      clearTimeout(timeout);
      fn();
    };

    // 기존 script 재사용 방지 — 최초 1회만 append
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-opencv="1"]',
    );
    if (existing) {
      existing.addEventListener("load", () => finish(settle));
      existing.addEventListener("error", () =>
        finish(() => reject(new Error("opencv script error"))),
      );
      // 이미 로드 완료됐을 수도 있음
      if (w.cv) finish(settle);
      return;
    }

    const script = document.createElement("script");
    script.src = "/opencv/opencv.js";
    script.async = true;
    script.dataset.opencv = "1";
    script.onload = () => finish(settle);
    script.onerror = () => finish(() => reject(new Error("opencv script error")));
    document.body.appendChild(script);
  });

  // 실패한 promise 는 캐시에서 제거해 다음 호출에서 재시도 가능하게.
  cvPromise.catch(() => {
    cvPromise = null;
  });

  return cvPromise;
}

// ─────────── 내부: 이미지 → 다운스케일 캔버스 ───────────

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// 긴 변을 maxLong 으로 제한한 처리용 캔버스 생성.
async function makeScaledCanvas(
  imgUrl: string,
  imgSize: ImgSize,
  maxLong: number,
): Promise<HTMLCanvasElement> {
  const img = await loadImage(imgUrl);
  const long = Math.max(imgSize.w, imgSize.h);
  const scale = long > maxLong ? maxLong / long : 1;
  const cw = Math.max(1, Math.round(imgSize.w * scale));
  const ch = Math.max(1, Math.round(imgSize.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d ctx");
  ctx.drawImage(img, 0, 0, cw, ch);
  return canvas;
}

// 4점을 TL,TR,BR,BL 순서로 정렬 (표준 order-points).
function orderPoints(
  pts: { x: number; y: number }[],
): [Point, Point, Point, Point] {
  // 합(x+y): 최소=TL, 최대=BR. 차(x-y): 최소=TR? 표준은 diff=y-x → 최소=TR, 최대=BL.
  let tl = pts[0],
    br = pts[0],
    tr = pts[0],
    bl = pts[0];
  let minSum = Infinity,
    maxSum = -Infinity,
    minDiff = Infinity,
    maxDiff = -Infinity;
  for (const p of pts) {
    const sum = p.x + p.y;
    const diff = p.y - p.x;
    if (sum < minSum) {
      minSum = sum;
      tl = p;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = p;
    }
    if (diff < minDiff) {
      minDiff = diff;
      tr = p;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      bl = p;
    }
  }
  return [tl, tr, br, bl];
}

// ─────────── (B) 문서 4각형 감지 ───────────

export async function detectDocumentCorners(
  imgUrl: string,
  imgSize: ImgSize,
): Promise<Corners | null> {
  // 반환 실패는 모두 null. throw 하지 않는다.
  let cv: any;
  try {
    cv = await loadOpenCV();
  } catch {
    return null;
  }
  if (!cv || typeof cv.Mat !== "function") return null;

  let canvas: HTMLCanvasElement;
  try {
    canvas = await makeScaledCanvas(imgUrl, imgSize, 1000);
  } catch {
    return null;
  }
  const cw = canvas.width;
  const ch = canvas.height;
  const totalArea = cw * ch;

  // OpenCV 리소스 — finally 에서 전부 해제.
  let src: any = null;
  let gray: any = null;
  let blurred: any = null;
  let edges: any = null;
  let kernel: any = null;
  let contours: any = null;
  let hierarchy: any = null;
  const approxPool: any[] = [];

  try {
    src = cv.imread(canvas);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    edges = new cv.Mat();
    cv.Canny(blurred, edges, 75, 200);
    // dilate 로 끊긴 엣지 연결 (문서 외곽 폐곡선 확보에 도움)
    kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, edges, kernel);

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    );

    // 면적 큰 순으로 인덱스 정렬
    const n = contours.size();
    const items: { idx: number; area: number }[] = [];
    for (let i = 0; i < n; i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt, false);
      cnt.delete();
      items.push({ idx: i, area });
    }
    items.sort((a, b) => b.area - a.area);

    let best: { x: number; y: number }[] | null = null;
    let bestArea = 0;

    // 큰 것부터 몇 개만 검사
    for (let k = 0; k < items.length && k < 8; k++) {
      const { idx, area } = items[k];
      if (area < totalArea * 0.3) break; // 이미 정렬됐으니 더 볼 필요 없음
      const cnt = contours.get(idx);
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      approxPool.push(approx);
      cv.approxPolyDP(cnt, approx, peri * 0.02, true);
      cnt.delete();
      // 4각형 & 볼록 검사
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const pts: { x: number; y: number }[] = [];
        for (let r = 0; r < 4; r++) {
          pts.push({
            x: approx.data32S[r * 2],
            y: approx.data32S[r * 2 + 1],
          });
        }
        if (area > bestArea) {
          bestArea = area;
          best = pts;
        }
      }
    }

    if (!best || bestArea < totalArea * 0.3) return null;

    const ordered = orderPoints(best);
    // 처리용 캔버스 크기로 정규화 (0~1) — 원본 스케일과 무관.
    const norm = ordered.map((p) => ({
      x: Math.min(1, Math.max(0, p.x / cw)),
      y: Math.min(1, Math.max(0, p.y / ch)),
    })) as Corners;
    return norm;
  } catch {
    return null;
  } finally {
    for (const a of approxPool) {
      try {
        a.delete();
      } catch {
        /* noop */
      }
    }
    for (const m of [src, gray, blurred, edges, kernel, contours, hierarchy]) {
      try {
        m?.delete();
      } catch {
        /* noop */
      }
    }
  }
}

// ─────────── (C) 90도 회전 필요 여부 휴리스틱 (순수 canvas) ───────────

export async function detectShouldRotate90(
  imgUrl: string,
  cornersNorm: Corners,
  imgSize: ImgSize,
): Promise<boolean> {
  try {
    const img = await loadImage(imgUrl);

    // 코너로 감싸는 축 정렬 바운딩 박스(원본 픽셀 기준)를 대략 잘라낸다.
    const pxPts = cornersNorm.map((p) => ({
      x: p.x * imgSize.w,
      y: p.y * imgSize.h,
    }));
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of pxPts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const rawW = Math.max(1, maxX - minX);
    const rawH = Math.max(1, maxY - minY);

    // 축소 그레이스케일 캔버스 (긴 변 400px)
    const maxLong = 400;
    const long = Math.max(rawW, rawH);
    const scale = long > maxLong ? maxLong / long : 1;
    const cw = Math.max(1, Math.round(rawW * scale));
    const ch = Math.max(1, Math.round(rawH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(img, minX, minY, rawW, rawH, 0, 0, cw, ch);

    const data = ctx.getImageData(0, 0, cw, ch).data;

    // 그레이스케일 행/열 프로파일
    const rowMean = new Float64Array(ch);
    const colMean = new Float64Array(cw);
    for (let y = 0; y < ch; y++) {
      let rs = 0;
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4;
        const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        rs += g;
        colMean[x] += g;
      }
      rowMean[y] = rs / cw;
    }
    for (let x = 0; x < cw; x++) colMean[x] /= ch;

    const variance = (arr: Float64Array): number => {
      let mean = 0;
      for (let i = 0; i < arr.length; i++) mean += arr[i];
      mean /= arr.length;
      let v = 0;
      for (let i = 0; i < arr.length; i++) {
        const d = arr[i] - mean;
        v += d * d;
      }
      return v / arr.length;
    };

    // 가로줄 텍스트가 올바로 서 있으면 행(row)별 밝기 변동(varRow)이 크다.
    // 눕혀진(90도) 경우 세로 방향으로 줄이 배열돼 열(col)별 변동(varCol)이 우세.
    const varRow = variance(rowMean);
    const varCol = variance(colMean);

    // varCol 이 명확히 우세할 때만 회전 권장. 애매하면 false.
    return varCol > varRow * 1.5;
  } catch {
    return false;
  }
}
