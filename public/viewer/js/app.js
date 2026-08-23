// 앱 셸 컨트롤러 — 화면 전환, 파일 열기, 최근 파일, 테마, SW 등록
import { detectFormat, FORMAT_LABELS } from "./detect.js";
import { addRecent, listRecents, deleteRecent, clearRecents, takeShared, requestPersistence } from "./db.js";
import { esc, formatSize, formatDate } from "./util.js";

const RENDERERS = {
  pdf: () => import("./renderers/pdf.js"),
  docx: () => import("./renderers/docx.js"),
  xlsx: () => import("./renderers/xlsx.js"),
  csv: () => import("./renderers/xlsx.js"),
  pptx: () => import("./renderers/pptx.js"),
  hwp: () => import("./renderers/hwp.js"),
  hwpx: () => import("./renderers/hwpx.js"),
  txt: () => import("./renderers/text.js"),
  md: () => import("./renderers/text.js"),
  image: () => import("./renderers/image.js"),
};

const $ = (sel) => document.querySelector(sel);
const homeView = $("#home-view");
const viewerView = $("#viewer-view");
const content = $("#viewer-content");
const fileInput = $("#file-input");
const errorPanel = $("#error-panel");

let current = null; // {controller, zoom}

// ---------- 테마 ----------
function applyTheme(theme) {
  if (theme === "dark" || theme === "light") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}
try {
  applyTheme(localStorage.getItem("theme"));
} catch { /* 저장소 접근 불가 환경 */ }
$("#theme-toggle").addEventListener("click", () => {
  const cur =
    document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("theme", next);
  } catch { /* 무시 */ }
});

// ---------- 화면 전환 ----------
function showHome() {
  if (current && current.controller) current.controller.destroy();
  current = null;
  content.innerHTML = "";
  errorPanel.hidden = true;
  viewerView.hidden = true;
  homeView.hidden = false;
  $("#page-info").textContent = "";
  refreshRecents();
}

function showViewer(name) {
  homeView.hidden = true;
  viewerView.hidden = false;
  errorPanel.hidden = true;
  $("#viewer-title").textContent = name;
  $("#page-info").textContent = "";
}

function showError(message) {
  if (current && current.controller) current.controller.destroy();
  current = null;
  content.innerHTML = "";
  $("#error-message").textContent = message;
  errorPanel.hidden = false;
}

// ---------- 줌 ----------
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
function setZoom(zoom) {
  if (!current) return;
  current.zoom = zoom;
  $("#zoom-label").textContent = Math.round(zoom * 100) + "%";
  if (current.controller && current.controller.supportsZoom) {
    current.controller.setZoom(zoom);
  } else {
    content.style.setProperty("--zoom", zoom);
    content.classList.toggle("css-zoomed", zoom !== 1);
  }
}
function stepZoom(dir) {
  if (!current) return;
  const idx = ZOOM_STEPS.findIndex((z) => Math.abs(z - current.zoom) < 0.01);
  const next = ZOOM_STEPS[Math.min(Math.max((idx === -1 ? 4 : idx) + dir, 0), ZOOM_STEPS.length - 1)];
  setZoom(next);
}
$("#zoom-in").addEventListener("click", () => stepZoom(1));
$("#zoom-out").addEventListener("click", () => stepZoom(-1));
$("#zoom-label").addEventListener("click", () => setZoom(1));

// ---------- 파일 열기 ----------
async function openFile(file, { addToRecents = true } = {}) {
  showViewer(file.name || "문서");
  content.innerHTML = '<div class="loading">여는 중…</div>';
  content.style.removeProperty("--zoom");
  content.classList.remove("css-zoomed");

  let detected;
  try {
    detected = await detectFormat(file);
  } catch {
    detected = { error: "파일을 읽는 중 오류가 발생했습니다." };
  }
  if (detected.error) {
    showError(detected.error);
    return;
  }
  const format = detected.format;
  $("#viewer-format").textContent = FORMAT_LABELS[format] || format;

  try {
    const mod = await RENDERERS[format]();
    content.innerHTML = "";
    const ctx = {
      format,
      setPageInfo(page, total) {
        $("#page-info").textContent = `${page} / ${total}`;
      },
    };
    const controller = await mod.render(file, content, ctx);
    current = { controller, zoom: 1 };
    $("#zoom-label").textContent = "100%";
    if (addToRecents) {
      addRecent({ name: file.name || "이름 없는 파일", size: file.size, format, blob: file }).then(
        refreshRecents,
        () => {},
      );
    }
  } catch (e) {
    showError(e && e.message ? e.message : "문서를 여는 중 오류가 발생했습니다.");
  }
}

$("#open-btn").addEventListener("click", () => fileInput.click());
$("#drop-zone").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) openFile(fileInput.files[0]);
  fileInput.value = "";
});
$("#back-btn").addEventListener("click", showHome);
$("#error-back").addEventListener("click", showHome);

// 드래그 앤 드롭 (데스크톱)
["dragover", "dragenter"].forEach((ev) =>
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    $("#drop-zone").classList.add("dragging");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    $("#drop-zone").classList.remove("dragging");
  }),
);
document.addEventListener("drop", (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) openFile(file);
});

// ---------- 최근 파일 ----------
async function refreshRecents() {
  const listEl = $("#recent-list");
  let items = [];
  try {
    items = await listRecents();
  } catch {
    /* IndexedDB 접근 불가 — 목록 숨김 */
  }
  $("#recent-section").hidden = items.length === 0;
  listEl.innerHTML = items
    .map(
      (r) => `
      <li class="recent-item" data-id="${r.id}">
        <button type="button" class="recent-open">
          <span class="recent-badge">${esc(FORMAT_LABELS[r.format] || r.format)}</span>
          <span class="recent-meta">
            <span class="recent-name">${esc(r.name)}</span>
            <span class="recent-sub">${formatSize(r.size)} · ${formatDate(r.ts)}</span>
          </span>
        </button>
        <button type="button" class="recent-delete" aria-label="삭제">✕</button>
      </li>`,
    )
    .join("");
  listEl.querySelectorAll(".recent-item").forEach((li) => {
    const id = Number(li.dataset.id);
    const item = items.find((r) => r.id === id);
    li.querySelector(".recent-open").addEventListener("click", () => {
      openFile(new File([item.blob], item.name, { type: item.blob.type }), { addToRecents: true });
    });
    li.querySelector(".recent-delete").addEventListener("click", async () => {
      await deleteRecent(id).catch(() => {});
      refreshRecents();
    });
  });
}
$("#clear-recents").addEventListener("click", async () => {
  await clearRecents().catch(() => {});
  refreshRecents();
});

// ---------- 서비스 워커 + 공유 수신 ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js", { updateViaCache: "none" })
    .catch(() => {/* 오프라인 기능만 비활성 — 앱은 정상 동작 */});
}

(async function init() {
  requestPersistence();
  refreshRecents();
  if (new URLSearchParams(location.search).has("shared")) {
    history.replaceState(null, "", location.pathname);
    try {
      const file = await takeShared();
      if (file) openFile(file);
    } catch {
      /* 수신함 비어 있음 */
    }
  }
})();
