// OpenCV.js lazy loader — script tag is injected on first call only.
// 캠스캐너 모달이 열릴 때만 호출되므로 초기 번들엔 영향 없음 (~8MB CDN, 캐시됨).

declare global {
  interface Window {
    cv?: unknown;
  }
}

let promise: Promise<unknown> | null = null;

export function loadOpenCV(): Promise<unknown> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const cvWin = window as Window & { cv?: { onRuntimeInitialized?: () => void } };
    if (cvWin.cv && (cvWin.cv as { Mat?: unknown }).Mat) return resolve(cvWin.cv);

    const onLoad = () => {
      const cv = cvWin.cv as { onRuntimeInitialized?: () => void; Mat?: unknown } | undefined;
      if (!cv) { reject(new Error("OpenCV 로드 실패: window.cv 없음")); return; }
      // Emscripten 모듈 — runtime 초기화가 끝날 때까지 대기
      if (cv.Mat) resolve(cv);
      else cv.onRuntimeInitialized = () => resolve(cv);
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-opencv-loader]');
    if (existing) {
      existing.addEventListener("load", onLoad);
      existing.addEventListener("error", () => reject(new Error("OpenCV CDN 로드 실패")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://docs.opencv.org/4.10.0/opencv.js";
    script.async = true;
    script.dataset.opencvLoader = "1";
    script.onload = onLoad;
    script.onerror = () => reject(new Error("OpenCV CDN 로드 실패"));
    document.head.appendChild(script);
  });
  return promise;
}
