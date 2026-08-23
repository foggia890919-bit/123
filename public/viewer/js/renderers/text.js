// TXT/마크다운 렌더러 — UTF-8 우선, 실패 시 EUC-KR (한국어 레거시 텍스트 대응)
import { loadScript, esc, sanitizeHtml } from "../util.js";

function decode(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("euc-kr").decode(buf);
  }
}

export async function render(file, container, ctx) {
  const text = decode(await file.arrayBuffer());
  const wrap = document.createElement("div");
  container.appendChild(wrap);

  if (ctx.format === "md") {
    await loadScript("lib/marked.umd.js");
    wrap.className = "md-body";
    wrap.innerHTML = sanitizeHtml(window.marked.parse(text));
  } else {
    wrap.className = "txt-body";
    const pre = document.createElement("pre");
    pre.innerHTML = esc(text);
    wrap.appendChild(pre);
  }
  return { destroy() {} };
}
