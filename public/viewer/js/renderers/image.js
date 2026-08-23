// 이미지 렌더러 — <img> 로만 표시 (SVG 포함, 스크립트 실행 없음)
export async function render(file, container) {
  const url = URL.createObjectURL(file);
  const wrap = document.createElement("div");
  wrap.className = "image-wrap";
  const img = document.createElement("img");
  img.alt = file.name || "이미지";
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("이미지를 표시할 수 없습니다."));
    img.src = url;
  });
  wrap.appendChild(img);
  container.appendChild(wrap);
  return {
    destroy() {
      URL.revokeObjectURL(url);
    },
  };
}
