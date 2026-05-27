// OpenCV.js lazy loader — 모달 첫 호출 시 CDN 에서 가져와 캐시.
// 8MB 가 넘는 큰 스크립트 + WebAssembly runtime 초기화가 별도로 필요해서
// onRuntimeInitialized 콜백 + polling 둘 다 사용 (race 방지).
//
// 30초 timeout — 그 안에 안 뜨면 reject 해서 자동 감지 실패 상태로 전환,
// 사용자는 수동 4코너 조정 가능.

declare global {
  interface Window {
    cv?: unknown;
  }
}

let promise: Promise<unknown> | null = null;
const LOAD_TIMEOUT_MS = 30_000;

export function loadOpenCV(): Promise<unknown> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const cvWin = window as Window & { cv?: { onRuntimeInitialized?: () => void; Mat?: unknown } };
    // 이미 완전히 초기화된 상태면 즉시 resolve
    if (cvWin.cv && (cvWin.cv as { Mat?: unknown }).Mat) return resolve(cvWin.cv);

    let settled = false;
    const start = Date.now();

    const poll = () => {
      if (settled) return;
      const cv = cvWin.cv;
      if (cv && (cv as { Mat?: unknown }).Mat) {
        settled = true;
        resolve(cv);
        return;
      }
      if (Date.now() - start > LOAD_TIMEOUT_MS) {
        settled = true;
        reject(new Error(`OpenCV.js 초기화 시간 초과 (${LOAD_TIMEOUT_MS / 1000}s) — CDN 차단 또는 네트워크 문제`));
        return;
      }
      setTimeout(poll, 150);
    };

    const onScriptLoad = () => {
      if (settled) return;
      const cv = cvWin.cv;
      if (cv && (cv as { Mat?: unknown }).Mat) {
        settled = true;
        resolve(cv);
        return;
      }
      // runtime 초기화 콜백 + 안전망 polling 동시 운영 — 어느 쪽이든 먼저 fire
      if (cv && typeof cv === "object") {
        (cv as { onRuntimeInitialized?: () => void }).onRuntimeInitialized = () => {
          if (settled) return;
          settled = true;
          resolve(cv);
        };
      }
      poll();
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-opencv-loader]');
    if (existing) {
      // 이미 script 태그가 있으면 load 이벤트 + polling 만
      if ((existing as HTMLScriptElement & { _loaded?: boolean })._loaded) {
        onScriptLoad();
      } else {
        existing.addEventListener("load", onScriptLoad);
        existing.addEventListener("error", () => {
          if (settled) return;
          settled = true;
          reject(new Error("OpenCV.js CDN 로드 실패"));
        });
        // 안전망: 이미 로드됐을 수도 있으니 polling 도 시작
        poll();
      }
      return;
    }
    const script = document.createElement("script");
    script.src = "https://docs.opencv.org/4.x/opencv.js";  // 4.x = 항상 최신 4.x stable
    script.async = true;
    script.dataset.opencvLoader = "1";
    script.onload = () => {
      (script as HTMLScriptElement & { _loaded?: boolean })._loaded = true;
      onScriptLoad();
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      reject(new Error("OpenCV.js CDN 로드 실패 (https://docs.opencv.org/4.x/opencv.js)"));
    };
    document.head.appendChild(script);
  }).catch((err) => {
    // 실패 시 promise 자체를 null 로 리셋해서 다음 호출에서 재시도 가능
    promise = null;
    throw err;
  });
  return promise;
}
