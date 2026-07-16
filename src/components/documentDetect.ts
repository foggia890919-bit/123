// 문서 자동 감지 — 메인 스레드 오케스트레이션 전용.
//
// 설계 원칙: 메인 스레드는 (1) 원본을 긴 변 800px 로 축소해 RGBA 를 뽑고,
// (2) Web Worker 를 만들어 그 버퍼를 transfer 로 넘긴 뒤, (3) 코너 4점 + 회전
// 여부만 받는다. OpenCV.js 로드/WASM 컴파일/모든 cv.* 연산은 전부 워커 안에서만
// 일어난다(→ public/opencv/detect-worker.js). 따라서 이 모듈에는 opencv import 도,
// cv.* 호출도, 동기 대기 루프도 없다. 메인 픽셀 작업은 800px 캔버스 1회
// drawImage + getImageData 뿐(수 ms).
//
// 실패(로드 실패/타임아웃/미지원)는 모두 조용히 { corners:null, shouldRotate:false }
// 로 귀결되어 모달의 수동 흐름을 100% 보존한다.

export interface Point {
  x: number;
  y: number;
}
// TL, TR, BR, BL (정규화 0~1)
export type Corners = [Point, Point, Point, Point];

export interface DetectResult {
  corners: Corners | null;
  shouldRotate: boolean;
}

interface ImgSize {
  w: number;
  h: number;
}

const WORKER_URL = "/opencv/detect-worker.js";
const MAX_LONG = 800; // 워커로 넘길 축소 이미지의 긴 변
const DEFAULT_TIMEOUT_MS = 15000;

const EMPTY: DetectResult = { corners: null, shouldRotate: false };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// 워커가 돌려준 코너를 검증/클램프. 유효하지 않으면 null.
function normalizeCorners(raw: unknown): Corners | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const out: Point[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push({
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    });
  }
  return out as Corners;
}

// 원본을 긴 변 MAX_LONG 으로 축소한 RGBA ImageData 를 만든다(메인, 경량).
async function makeScaledImageData(
  imgUrl: string,
  imgSize: ImgSize,
): Promise<{ data: ImageData; w: number; h: number } | null> {
  try {
    const img = await loadImage(imgUrl);
    const long = Math.max(imgSize.w, imgSize.h);
    const scale = long > MAX_LONG ? MAX_LONG / long : 1;
    const cw = Math.max(1, Math.round(imgSize.w * scale));
    const ch = Math.max(1, Math.round(imgSize.h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, cw, ch);
    return { data: ctx.getImageData(0, 0, cw, ch), w: cw, h: ch };
  } catch {
    return null;
  }
}

// 자동 감지 진입점. 절대 throw 하지 않으며, 메인 스레드를 블로킹하는 경로가 없다.
// 15초 안에 워커가 응답하지 않으면 워커를 terminate 하고 EMPTY 를 반환한다.
export async function detectDocument(
  imgUrl: string,
  imgSize: ImgSize,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DetectResult> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return EMPTY;
  }

  const scaled = await makeScaledImageData(imgUrl, imgSize);
  if (!scaled) return EMPTY;

  return new Promise<DetectResult>((resolve) => {
    let worker: Worker | null = null;
    let settled = false;

    const finish = (result: DetectResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (worker) {
        try {
          worker.terminate();
        } catch {
          /* noop */
        }
        worker = null;
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(EMPTY), timeoutMs);

    try {
      worker = new Worker(WORKER_URL);
    } catch {
      finish(EMPTY);
      return;
    }

    worker.onmessage = (ev: MessageEvent) => {
      const d = (ev.data || {}) as { corners?: unknown; shouldRotate?: unknown };
      finish({
        corners: normalizeCorners(d.corners),
        shouldRotate: !!d.shouldRotate,
      });
    };
    worker.onerror = () => finish(EMPTY);
    worker.onmessageerror = () => finish(EMPTY);

    try {
      const buffer = scaled.data.data.buffer;
      worker.postMessage(
        { id: 1, buffer, width: scaled.w, height: scaled.h },
        [buffer], // transfer — 복사 없이 소유권 이전
      );
    } catch {
      finish(EMPTY);
    }
  });
}
