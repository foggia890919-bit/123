// DOCX 렌더러 — docx-preview (JSZip 전역 필요)
import { loadScript } from "../util.js";

export async function render(file, container) {
  await loadScript("lib/jszip.min.js");
  await loadScript("lib/docx-preview.min.js");

  const wrap = document.createElement("div");
  wrap.className = "docx-wrap";
  container.appendChild(wrap);

  try {
    await window.docx.renderAsync(await file.arrayBuffer(), wrap, null, {
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      experimental: true,
      useBase64URL: true,
    });
  } catch {
    throw new Error("워드 문서를 해석할 수 없습니다. 파일이 손상되었거나 암호화되어 있을 수 있습니다.");
  }

  return { destroy() {} };
}
