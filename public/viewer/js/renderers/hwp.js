// HWP 5.0 렌더러 — hwp.js 번들 (본문 열람 품질; 암호화/배포용 문서 미지원)
import { loadScript } from "../util.js";

export async function render(file, container) {
  await loadScript("lib/hwp.bundle.js");

  const wrap = document.createElement("div");
  wrap.className = "hwp-wrap";
  container.appendChild(wrap);

  let viewer;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    viewer = new window.HWP.Viewer(wrap, data, { type: "binary" });
  } catch {
    throw new Error(
      "한글 문서를 열 수 없습니다. 암호화되었거나 배포용(DRM) 문서, 또는 지원 범위를 벗어난 문서일 수 있습니다.",
    );
  }

  return {
    destroy() {
      try {
        if (viewer && typeof viewer.distory === "function") viewer.distory();
      } catch {
        /* 뷰어 내부 정리 실패는 무시 */
      }
    },
  };
}
