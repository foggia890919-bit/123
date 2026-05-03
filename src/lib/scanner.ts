// 캠스캐너식 문서 스캔 — OpenCV.js + jscanify 를 CDN 에서 동적 로드해 사용
// 클라이언트에서 이미지의 4 모서리를 자동 감지 → 원근 변환 → 평면 직사각형으로 보정.

interface Jscanify {
  extractPaper(canvas: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement;
  findPaperContour(image: unknown): unknown;
  highlightPaper(canvas: HTMLCanvasElement): HTMLCanvasElement;
}

declare global {
  interface Window {
    cv?: { onRuntimeInitialized?: () => void; Mat?: unknown };
    jscanify?: new () => Jscanify;
  }
}

let scannerPromise: Promise<Jscanify> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("브라우저 환경 아님"));
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(`스크립트 로드 실패: ${src}`)));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => { s.dataset.loaded = "true"; resolve(); };
    s.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
    document.body.appendChild(s);
  });
}

async function waitForOpenCV(): Promise<void> {
  if (typeof window === "undefined") throw new Error("브라우저 환경 아님");
  // opencv.js 가 로드돼도 wasm 런타임 초기화는 비동기. cv.Mat 가 준비될 때까지 대기.
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (window.cv && (window.cv as { Mat?: unknown }).Mat) return resolve();
      if (Date.now() - start > 30000) return reject(new Error("OpenCV 초기화 시간 초과"));
      setTimeout(tick, 100);
    };
    if (window.cv) {
      // 기존 객체에 onRuntimeInitialized 후크 시도
      const cv = window.cv;
      if ((cv as { Mat?: unknown }).Mat) return resolve();
      cv.onRuntimeInitialized = () => resolve();
    }
    tick();
  });
}

export async function loadScanner(): Promise<Jscanify> {
  if (scannerPromise) return scannerPromise;
  scannerPromise = (async () => {
    // 1) OpenCV.js (약 8MB, 첫 호출 시 다운로드)
    await loadScript("https://docs.opencv.org/4.5.0/opencv.js");
    await waitForOpenCV();
    // 2) jscanify
    await loadScript("https://cdn.jsdelivr.net/gh/puffinsoft/jscanify@master/src/jscanify.min.js");
    if (!window.jscanify) throw new Error("jscanify 가 전역에 로드되지 않음");
    return new window.jscanify();
  })();
  // 실패 시 다음 호출에서 재시도 가능하도록 promise 캐시 클리어
  scannerPromise.catch(() => { scannerPromise = null; });
  return scannerPromise;
}

// File → 보정된 PNG Blob. 모서리를 못 찾으면 null 반환 (호출자가 원본 사용).
export async function extractPaper(file: File): Promise<Blob | null> {
  const scanner = await loadScanner();

  // File → ImageBitmap → canvas
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);

    // 출력 해상도: 원본의 짧은 변을 기준으로 A4 비율로 확장 (최대 2400 x 3393)
    const outW = Math.min(2400, Math.max(1200, Math.round(canvas.width * 0.9)));
    const outH = Math.round(outW * 1.414); // A4 세로 비율

    let extracted: HTMLCanvasElement;
    try {
      extracted = scanner.extractPaper(canvas, outW, outH);
    } catch {
      return null; // 모서리 감지 실패
    }
    if (!extracted) return null;

    return await new Promise<Blob | null>((resolve) => {
      extracted.toBlob((b) => resolve(b), "image/jpeg", 0.92);
    });
  } finally {
    bitmap.close();
  }
}
