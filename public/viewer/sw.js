// 서비스 워커 — 앱 셸 사전 캐시(오프라인) + share_target POST 수신
// 캐시 무효화: 아래 VERSION 을 올리면 다음 방문 시 전체 갱신된다.
const VERSION = "v1";
const CACHE = "viewer-" + VERSION;
const BASE = "/viewer/";

const PRECACHE = [
  BASE + "index.html",
  BASE + "manifest.webmanifest",
  BASE + "css/app.css",
  BASE + "js/app.js",
  BASE + "js/util.js",
  BASE + "js/detect.js",
  BASE + "js/db.js",
  BASE + "js/renderers/pdf.js",
  BASE + "js/renderers/docx.js",
  BASE + "js/renderers/xlsx.js",
  BASE + "js/renderers/pptx.js",
  BASE + "js/renderers/hwp.js",
  BASE + "js/renderers/hwpx.js",
  BASE + "js/renderers/text.js",
  BASE + "js/renderers/image.js",
  BASE + "lib/jszip.min.js",
  BASE + "lib/xlsx.full.min.js",
  BASE + "lib/docx-preview.min.js",
  BASE + "lib/pptx-preview.umd.js",
  BASE + "lib/marked.umd.js",
  BASE + "lib/hwp.bundle.js",
  BASE + "lib/pdfjs/pdf.min.mjs",
  BASE + "lib/pdfjs/pdf.worker.min.mjs",
  // 한국어 PDF (CID 폰트) 오프라인 지원용 cmap — 나머지 cmap 은 런타임 캐시
  BASE + "lib/pdfjs/cmaps/UniKS-UCS2-H.bcmap",
  BASE + "lib/pdfjs/cmaps/UniKS-UCS2-V.bcmap",
  BASE + "lib/pdfjs/cmaps/UniKS-UTF16-H.bcmap",
  BASE + "lib/pdfjs/cmaps/UniKS-UTF16-V.bcmap",
  BASE + "icons/icon-192.png",
  BASE + "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("viewer-") && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 다른 앱에서 "공유"로 넘어온 파일 수신
  if (event.request.method === "POST" && url.pathname === BASE + "share-target") {
    event.respondWith(handleShare(event));
    return;
  }

  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (!url.pathname.startsWith(BASE)) return;

  // cmaps / standard_fonts 는 요청 시점에 캐시 (파일 수가 많아 사전 캐시 제외)
  const runtimeCacheable =
    url.pathname.startsWith(BASE + "lib/pdfjs/cmaps/") ||
    url.pathname.startsWith(BASE + "lib/pdfjs/standard_fonts/");

  event.respondWith(
    caches.match(event.request, { ignoreSearch: url.pathname === BASE + "index.html" }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok && runtimeCacheable) {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        }
        return res;
      });
    }),
  );
});

async function handleShare(event) {
  try {
    const form = await event.request.formData();
    const file = form.get("file") || form.getAll("files")[0];
    if (file && file.size !== undefined) {
      await idbPutShared({ name: file.name || "", blob: file, ts: Date.now() });
    }
  } catch {
    /* 수신 실패 — 홈으로만 이동 */
  }
  return Response.redirect(BASE + "index.html?shared=1", 303);
}

// db.js 와 동일한 DB/스토어 스키마 (모듈 import 불가한 클래식 SW 라 최소 구현 중복)
function idbPutShared(record) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("doc-viewer", 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("recents")) {
        db.createObjectStore("recents", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("shared")) {
        db.createObjectStore("shared", { keyPath: "id", autoIncrement: true });
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("shared", "readwrite");
      tx.objectStore("shared").add(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  });
}
