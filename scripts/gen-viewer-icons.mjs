/**
 * 뷰어 PWA 아이콘 생성 — sharp (기존 의존성) 로 SVG → PNG 렌더.
 * 실행: node scripts/gen-viewer-icons.mjs
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "viewer", "icons");
mkdirSync(out, { recursive: true });

// pad: maskable 용 안전 영역 여백 비율
function iconSvg(pad = 0) {
  const s = 512;
  const inset = s * pad;
  const w = s - inset * 2;
  const doc = {
    x: inset + w * 0.26,
    y: inset + w * 0.17,
    w: w * 0.48,
    h: w * 0.62,
    r: w * 0.05,
  };
  const fold = w * 0.14;
  const lineX = doc.x + doc.w * 0.16;
  const lineW = doc.w * 0.68;
  const lines = [0.42, 0.56, 0.7]
    .map(
      (t) =>
        `<rect x="${lineX}" y="${doc.y + doc.h * t}" width="${lineW}" height="${w * 0.035}" rx="${w * 0.017}" fill="#c7d7fe"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#1e40af"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="${pad > 0 ? 0 : s * 0.22}" fill="url(#bg)"/>
  <path d="M ${doc.x} ${doc.y + doc.r}
           a ${doc.r} ${doc.r} 0 0 1 ${doc.r} ${-doc.r}
           h ${doc.w - fold - doc.r}
           l ${fold} ${fold}
           v ${doc.h - fold - doc.r}
           a ${doc.r} ${doc.r} 0 0 1 ${-doc.r} ${doc.r}
           h ${-(doc.w - doc.r * 2)}
           a ${doc.r} ${doc.r} 0 0 1 ${-doc.r} ${-doc.r}
           z" fill="#ffffff"/>
  <path d="M ${doc.x + doc.w - fold} ${doc.y} l ${fold} ${fold} h ${-fold} z" fill="#bfdbfe"/>
  ${lines}
  <text x="${doc.x + doc.w * 0.42}" y="${doc.y + doc.h * 0.33}" font-family="sans-serif"
        font-size="${w * 0.13}" font-weight="800" fill="#1d4ed8" text-anchor="middle">뷰</text>
</svg>`;
}

const jobs = [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["icon-maskable-512.png", 512, 0.1],
  ["apple-touch-icon.png", 180, 0],
];
for (const [name, size, pad] of jobs) {
  await sharp(Buffer.from(iconSvg(pad))).resize(size, size).png().toFile(join(out, name));
  console.log("generated", name);
}
