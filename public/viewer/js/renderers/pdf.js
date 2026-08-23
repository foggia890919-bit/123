// PDF 렌더러 — pdf.js(legacy ESM). 페이지 지연 렌더 + 줌 시 선명하게 재렌더.
const LIB = new URL("../../lib/pdfjs/", import.meta.url);

export async function render(file, container, ctx) {
  const pdfjs = await import(new URL("pdf.min.mjs", LIB).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", LIB).href;

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: await file.arrayBuffer(),
      cMapUrl: new URL("cmaps/", LIB).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("standard_fonts/", LIB).href,
    }).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") {
      throw new Error("암호가 걸린 PDF 입니다. 암호 해제 후 열어주세요.");
    }
    throw new Error("PDF 를 해석할 수 없습니다. 파일이 손상되었을 수 있습니다.");
  }

  const wrap = document.createElement("div");
  wrap.className = "pdf-pages";
  container.appendChild(wrap);

  let zoom = 1;
  let destroyed = false;
  const pages = []; // {el, canvas, num, renderedZoom, rendering}

  // 페이지 1의 원본 크기로 화면 맞춤 배율 계산
  const first = await doc.getPage(1);
  const baseViewport = first.getViewport({ scale: 1 });
  const fitScale = () =>
    Math.min((container.clientWidth - 16) / baseViewport.width, 2.5);

  for (let n = 1; n <= doc.numPages; n++) {
    const el = document.createElement("div");
    el.className = "pdf-page";
    const canvas = document.createElement("canvas");
    el.appendChild(canvas);
    wrap.appendChild(el);
    pages.push({ el, canvas, num: n, renderedZoom: 0, rendering: false });
  }

  function sizePlaceholders() {
    const s = fitScale() * zoom;
    for (const p of pages) {
      p.el.style.width = Math.floor(baseViewport.width * s) + "px";
      p.el.style.height = Math.floor(baseViewport.height * s) + "px";
    }
  }
  sizePlaceholders();

  async function renderPage(p) {
    if (destroyed || p.rendering || p.renderedZoom === zoom) return;
    p.rendering = true;
    const targetZoom = zoom;
    try {
      const page = await doc.getPage(p.num);
      const scale = fitScale() * targetZoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * dpr });
      p.canvas.width = viewport.width;
      p.canvas.height = viewport.height;
      p.canvas.style.width = Math.floor(viewport.width / dpr) + "px";
      p.canvas.style.height = Math.floor(viewport.height / dpr) + "px";
      // 페이지별 실제 크기 반영 (첫 페이지와 다를 수 있음)
      p.el.style.width = p.canvas.style.width;
      p.el.style.height = p.canvas.style.height;
      await page.render({ canvasContext: p.canvas.getContext("2d"), viewport }).promise;
      p.renderedZoom = targetZoom;
    } catch {
      /* 개별 페이지 실패 — 자리만 유지 */
    } finally {
      p.rendering = false;
      if (!destroyed && p.renderedZoom !== zoom) renderPage(p); // 줌이 그새 바뀐 경우
    }
  }

  const visible = new Set();
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const p = pages[[...wrap.children].indexOf(entry.target)];
        if (!p) continue;
        if (entry.isIntersecting) {
          visible.add(p.num);
          renderPage(p);
        } else {
          visible.delete(p.num);
        }
      }
      if (visible.size && ctx.setPageInfo) {
        ctx.setPageInfo(Math.min(...visible), doc.numPages);
      }
    },
    { root: null, rootMargin: "600px 0px" },
  );
  pages.forEach((p) => io.observe(p.el));
  if (ctx.setPageInfo) ctx.setPageInfo(1, doc.numPages);

  return {
    supportsZoom: true,
    setZoom(z) {
      zoom = z;
      sizePlaceholders();
      pages.filter((p) => visible.has(p.num)).forEach(renderPage);
    },
    destroy() {
      destroyed = true;
      io.disconnect();
      doc.destroy();
    },
  };
}
