// PPTX 렌더러 — pptx-preview 우선, 실패 시 자체 텍스트/이미지 추출 폴백
import { loadScript, esc } from "../util.js";

export async function render(file, container) {
  const buf = await file.arrayBuffer();
  try {
    await loadScript("lib/pptx-preview.umd.js");
    const wrap = document.createElement("div");
    wrap.className = "pptx-wrap";
    container.appendChild(wrap);
    const width = Math.min(container.clientWidth - 8, 960);
    const previewer = window.pptxPreview.init(wrap, {
      width,
      height: Math.round((width * 9) / 16),
      mode: "slide",
    });
    await previewer.preview(buf.slice(0));
    if (!wrap.childElementCount) throw new Error("empty render");
    return { destroy() {} };
  } catch {
    // 폴백: 슬라이드별 텍스트 + 이미지 추출
    container.innerHTML = "";
    return fallbackRender(file, buf, container);
  }
}

async function fallbackRender(file, buf, container) {
  await loadScript("lib/jszip.min.js");
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error("파워포인트 파일을 열 수 없습니다. 파일이 손상되었을 수 있습니다.");
  }

  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  if (!slideNames.length) throw new Error("슬라이드를 찾을 수 없습니다.");

  const wrap = document.createElement("div");
  wrap.className = "pptx-fallback";
  const notice = document.createElement("p");
  notice.className = "pptx-notice";
  notice.textContent =
    "이 프레젠테이션은 단순 보기(텍스트·이미지)로 표시됩니다. 도형·차트·서식은 생략될 수 있습니다.";
  wrap.appendChild(notice);
  container.appendChild(wrap);

  const objectUrls = [];
  for (let i = 0; i < slideNames.length; i++) {
    const name = slideNames[i];
    const card = document.createElement("section");
    card.className = "pptx-slide";
    card.innerHTML = `<h3 class="pptx-slide-no">슬라이드 ${i + 1}</h3>`;

    const doc = new DOMParser().parseFromString(await zip.file(name).async("string"), "text/xml");
    // 문단 단위 텍스트 (a:p 안의 a:t 연결)
    for (const p of doc.getElementsByTagName("*")) {
      if (p.localName !== "p" || p.namespaceURI === null) continue;
      let text = "";
      for (const t of p.getElementsByTagName("*")) {
        if (t.localName === "t") text += t.textContent;
      }
      if (text.trim()) card.insertAdjacentHTML("beforeend", `<p>${esc(text)}</p>`);
    }

    // 슬라이드 관계 파일에서 이미지 참조 수집
    const relName = name.replace("slides/", "slides/_rels/") + ".rels";
    const rel = zip.file(relName);
    if (rel) {
      const relDoc = new DOMParser().parseFromString(await rel.async("string"), "text/xml");
      for (const r of relDoc.getElementsByTagName("*")) {
        if (r.localName !== "Relationship") continue;
        const target = r.getAttribute("Target") || "";
        if (!/\.(png|jpe?g|gif|bmp|webp)$/i.test(target)) continue;
        const path = target.replace(/^\.\.\//, "ppt/");
        const entry = zip.file(path);
        if (!entry) continue;
        const url = URL.createObjectURL(await entry.async("blob"));
        objectUrls.push(url);
        const img = document.createElement("img");
        img.className = "pptx-img";
        img.src = url;
        card.appendChild(img);
      }
    }
    wrap.appendChild(card);
  }

  return {
    destroy() {
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
    },
  };
}
