/**
 * 모바일 문서 뷰어 PWA(public/viewer/)용 서드파티 라이브러리 벤더링 스크립트.
 *
 * node_modules 의 브라우저용 dist 를 public/viewer/lib/ 로 복사하고,
 * 브라우저 빌드가 없는 hwp.js 는 esbuild 로 fs 를 심 처리해 IIFE 번들을 생성한다.
 *
 * 실행: node scripts/vendor-viewer.mjs
 * (라이브러리 업그레이드 시에만 수동 실행 — next build 와는 무관)
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");
const lib = join(root, "public", "viewer", "lib");

rmSync(lib, { recursive: true, force: true });
mkdirSync(lib, { recursive: true });

const copies = [
  // [소스(node_modules 기준), 대상(lib 기준)]
  ["pdfjs-dist/legacy/build/pdf.min.mjs", "pdfjs/pdf.min.mjs"],
  ["pdfjs-dist/legacy/build/pdf.worker.min.mjs", "pdfjs/pdf.worker.min.mjs"],
  ["pdfjs-dist/cmaps", "pdfjs/cmaps"],
  ["pdfjs-dist/standard_fonts", "pdfjs/standard_fonts"],
  ["docx-preview/dist/docx-preview.min.js", "docx-preview.min.js"],
  ["jszip/dist/jszip.min.js", "jszip.min.js"],
  ["xlsx/dist/xlsx.full.min.js", "xlsx.full.min.js"],
  ["pptx-preview/dist/pptx-preview.umd.js", "pptx-preview.umd.js"],
  ["marked/lib/marked.umd.js", "marked.umd.js"],
];

for (const [src, dest] of copies) {
  const to = join(lib, dest);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(join(nm, src), to, { recursive: true });
  console.log(`copied ${src} -> lib/${dest}`);
}

// hwp.js: build/esm.js 가 top-level `import ... from 'fs'` 를 포함해 브라우저에서
// 그대로 로드 불가. fs 사용부는 Node 감지 가드 뒤에 있으므로 빈 심으로 대체해도 안전.
const shim = join(root, "scripts", ".fs-shim.mjs");
writeFileSync(shim, "export default {};\n");
try {
  execFileSync(
    join(nm, ".bin", "esbuild"),
    [
      join(nm, "hwp.js", "build", "esm.js"),
      "--bundle",
      "--minify",
      "--format=iife",
      "--global-name=HWP",
      `--alias:fs=${shim}`,
      `--outfile=${join(lib, "hwp.bundle.js")}`,
    ],
    { stdio: "inherit" },
  );
} finally {
  rmSync(shim, { force: true });
}
console.log("bundled hwp.js -> lib/hwp.bundle.js");

// 결과 요약
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
const files = walk(lib);
const total = files.reduce((s, f) => s + statSync(f).size, 0);
console.log(`\n${files.length} files, ${(total / 1024 / 1024).toFixed(1)} MB total in public/viewer/lib/`);
