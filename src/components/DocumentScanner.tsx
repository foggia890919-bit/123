"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Check, RotateCcw, Grid3x3, Square } from "lucide-react";

interface Point { x: number; y: number }
type Corners = [Point, Point, Point, Point]; // TL, TR, BR, BL (normalized 0-1)
type Mesh = Point[][]; // mesh[row][col], row 0..MESH_N, col 0..MESH_N

const MESH_N = 3; // 4×4 격자 (3행 3열의 셀 = 9 sub-quads)
type Mode = "corners" | "mesh";

interface Props {
  file: File;
  onConfirm: (correctedFile: File) => void;
  onSkip: () => void;
  onCancel: () => void;
}

function defaultCorners(): Corners {
  return [
    { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 },
    { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 },
  ];
}

function defaultMesh(corners: Corners): Mesh {
  // 외곽 4점은 corners 와 동일하게, 내부 점은 bilinear 보간
  const tl = corners[0], tr = corners[1], br = corners[2], bl = corners[3];
  const grid: Mesh = [];
  for (let r = 0; r <= MESH_N; r++) {
    const tr_ = r / MESH_N;
    const left = { x: tl.x + (bl.x - tl.x) * tr_, y: tl.y + (bl.y - tl.y) * tr_ };
    const right = { x: tr.x + (br.x - tr.x) * tr_, y: tr.y + (br.y - tr.y) * tr_ };
    const row: Point[] = [];
    for (let c = 0; c <= MESH_N; c++) {
      const tc = c / MESH_N;
      row.push({ x: left.x + (right.x - left.x) * tc, y: left.y + (right.y - left.y) * tc });
    }
    grid.push(row);
  }
  return grid;
}

export default function DocumentScanner({ file, onConfirm, onSkip, onCancel }: Props) {
  const [imgUrl, setImgUrl] = useState<string>("");
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [mode, setMode] = useState<Mode>("corners");
  const [corners, setCorners] = useState<Corners>(defaultCorners());
  const [mesh, setMesh] = useState<Mesh>(() => defaultMesh(defaultCorners()));
  const [dragging, setDragging] = useState<{ kind: Mode; idx: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  // 모드 전환 시 mesh 를 corners 기반으로 초기화 (반대 방향은 외곽만 가져옴)
  function switchMode(next: Mode) {
    if (next === "mesh") {
      setMesh(defaultMesh(corners));
    } else {
      // mesh → corners: 외곽 4점만 가져옴
      setCorners([
        mesh[0][0], mesh[0][MESH_N],
        mesh[MESH_N][MESH_N], mesh[MESH_N][0],
      ]);
    }
    setMode(next);
  }

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      if (dragging.kind === "corners") {
        setCorners((prev) => {
          const next = [...prev] as Corners;
          next[dragging.idx] = { x, y };
          return next;
        });
      } else {
        const r = Math.floor(dragging.idx / (MESH_N + 1));
        const c = dragging.idx % (MESH_N + 1);
        setMesh((prev) => {
          const next = prev.map((row) => row.slice());
          next[r][c] = { x, y };
          return next;
        });
      }
    };
    const up = () => setDragging(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging]);

  function reset() {
    if (mode === "corners") setCorners(defaultCorners());
    else setMesh(defaultMesh(defaultCorners()));
  }

  async function handleConfirm() {
    if (!imgSize) return;
    setBusy(true);
    try {
      let corrected: File;
      if (mode === "corners") {
        corrected = await applyPerspective(imgUrl, corners, imgSize, file.type || "image/jpeg", file.name);
      } else {
        corrected = await applyMeshPerspective(imgUrl, mesh, imgSize, file.type || "image/jpeg", file.name);
      }
      onConfirm(corrected);
    } catch (e) {
      console.error("[Scanner] warp failed", e);
      onConfirm(file); // fallback to original
    } finally {
      setBusy(false);
    }
  }

  // 외곽 다각형 path (corners 모드 = 4점, mesh 모드 = 외곽 12점)
  const polyPath = (() => {
    let pts: Point[];
    if (mode === "corners") {
      pts = corners;
    } else {
      pts = [
        ...mesh[0],
        ...Array.from({ length: MESH_N - 1 }, (_, i) => mesh[i + 1][MESH_N]),
        ...mesh[MESH_N].slice().reverse(),
        ...Array.from({ length: MESH_N - 1 }, (_, i) => mesh[MESH_N - 1 - i][0]),
      ];
    }
    return pts.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x * 100} ${c.y * 100}`).join(" ") + " Z";
  })();

  // mesh 모드: 격자 선
  const meshLines: string[] = [];
  if (mode === "mesh") {
    for (let r = 0; r <= MESH_N; r++) {
      const row = mesh[r];
      meshLines.push(row.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * 100} ${p.y * 100}`).join(" "));
    }
    for (let c = 0; c <= MESH_N; c++) {
      const col = mesh.map((row) => row[c]);
      meshLines.push(col.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * 100} ${p.y * 100}`).join(" "));
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <div className="flex items-center justify-between mb-3 text-white">
          <div>
            <h2 className="text-base font-semibold">캠스캐너 보정</h2>
            <p className="text-xs text-gray-300">
              {mode === "corners"
                ? "표 영역 4 모서리를 드래그해서 맞춘 뒤 보정하세요"
                : "꾸겨진 종이용 — 16개 점을 종이 표면 그리드에 맞춰서 끌어주세요"}
            </p>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-white/10 rounded" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 모드 토글 */}
        <div className="flex gap-1 bg-white/10 rounded-md p-1 mb-3 w-fit">
          <button
            onClick={() => switchMode("corners")}
            disabled={busy}
            className={`px-3 py-1.5 text-xs rounded inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
              mode === "corners" ? "bg-white text-gray-900 font-medium" : "text-white/80 hover:bg-white/10"
            }`}
          >
            <Square className="w-3.5 h-3.5" /> 평평 (4코너)
          </button>
          <button
            onClick={() => switchMode("mesh")}
            disabled={busy}
            className={`px-3 py-1.5 text-xs rounded inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
              mode === "mesh" ? "bg-white text-gray-900 font-medium" : "text-white/80 hover:bg-white/10"
            }`}
          >
            <Grid3x3 className="w-3.5 h-3.5" /> 꾸겨짐 ({(MESH_N + 1) * (MESH_N + 1)}점)
          </button>
        </div>

        <div className="w-full bg-gray-900 rounded-lg overflow-auto flex items-center justify-center" style={{ maxHeight: "70vh" }}>
          <div ref={overlayRef} className="relative inline-block select-none touch-none">
            {imgUrl && (
              <img ref={imgRef} src={imgUrl} onLoad={onImgLoad} alt="원본"
                   className="block max-w-full max-h-[70vh] pointer-events-none"
                   draggable={false} />
            )}
            <svg className="absolute inset-0 w-full h-full pointer-events-none"
                 viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d={polyPath} fill="rgba(59,130,246,0.15)" stroke="rgb(59,130,246)" strokeWidth="0.4"
                    vectorEffect="non-scaling-stroke" />
              {meshLines.map((d, i) => (
                <path key={i} d={d} fill="none" stroke="rgba(59,130,246,0.55)" strokeWidth="0.25"
                      vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            {/* corners 모드 핸들 */}
            {mode === "corners" && corners.map((c, i) => (
              <button key={`c-${i}`}
                onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDragging({ kind: "corners", idx: i }); }}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border-2 border-blue-500 shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                aria-label={`코너 ${i + 1}`}>
                <span className="block w-2 h-2 rounded-full bg-blue-500" />
              </button>
            ))}
            {/* mesh 모드 핸들 */}
            {mode === "mesh" && mesh.flatMap((row, r) =>
              row.map((p, c) => {
                const idx = r * (MESH_N + 1) + c;
                const isCorner = (r === 0 || r === MESH_N) && (c === 0 || c === MESH_N);
                return (
                  <button key={`m-${idx}`}
                    onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDragging({ kind: "mesh", idx }); }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white border-2 shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing touch-none ${
                      isCorner ? "w-7 h-7 border-blue-600" : "w-5 h-5 border-blue-400"
                    }`}
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                    aria-label={`mesh ${r},${c}`}>
                    <span className={`block rounded-full bg-blue-500 ${isCorner ? "w-2 h-2" : "w-1.5 h-1.5"}`} />
                  </button>
                );
              }),
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
          <div className="flex gap-2">
            <button onClick={reset} disabled={busy}
                    className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 text-white rounded inline-flex items-center gap-1 disabled:opacity-50">
              <RotateCcw className="w-3.5 h-3.5" /> 초기화
            </button>
            <button onClick={onSkip} disabled={busy}
                    className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 text-white rounded disabled:opacity-50">
              보정 없이 사용
            </button>
          </div>
          <button onClick={handleConfirm} disabled={busy || !imgSize}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded inline-flex items-center gap-1.5 disabled:opacity-50 font-medium">
            <Check className="w-4 h-4" /> {busy ? "보정 중..." : "보정 적용"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────── Perspective transform: 4-corner ───────────

async function applyPerspective(
  imgUrl: string,
  cornersNorm: Corners,
  imgSize: { w: number; h: number },
  mimeType: string,
  fileName: string,
): Promise<File> {
  const c = cornersNorm.map((p) => ({ x: p.x * imgSize.w, y: p.y * imgSize.h }));
  const widthTop = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
  const widthBot = Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y);
  const heightLeft = Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y);
  const heightRight = Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y);
  const W = Math.min(2400, Math.round(Math.max(widthTop, widthBot)));
  const H = Math.min(2400, Math.round(Math.max(heightLeft, heightRight)));

  const M = getPerspectiveTransform(
    [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
    c,
  );

  const { src, sw, sh } = await loadSourceImageData(imgUrl, imgSize);
  const outCanvas = document.createElement("canvas");
  outCanvas.width = W; outCanvas.height = H;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("no out ctx");
  const outImg = outCtx.createImageData(W, H);

  warpRegion(src.data, sw, sh, outImg.data, W, 0, 0, W, H, M);
  outCtx.putImageData(outImg, 0, 0);
  enhanceContrast(outCtx, W, H);

  return await canvasToFile(outCanvas, mimeType, fileName);
}

// ─────────── Perspective transform: 4×4 mesh (piecewise) ───────────

async function applyMeshPerspective(
  imgUrl: string,
  meshNorm: Mesh,
  imgSize: { w: number; h: number },
  mimeType: string,
  fileName: string,
): Promise<File> {
  // 픽셀 좌표로 변환
  const m: Point[][] = meshNorm.map((row) => row.map((p) => ({ x: p.x * imgSize.w, y: p.y * imgSize.h })));

  // 출력 사이즈: 외곽 4코너 기준
  const tl = m[0][0], tr = m[0][MESH_N], br = m[MESH_N][MESH_N], bl = m[MESH_N][0];
  const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const widthBot = Math.hypot(br.x - bl.x, br.y - bl.y);
  const heightLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);
  const W = Math.min(2400, Math.round(Math.max(widthTop, widthBot)));
  const H = Math.min(2400, Math.round(Math.max(heightLeft, heightRight)));

  const { src, sw, sh } = await loadSourceImageData(imgUrl, imgSize);
  const outCanvas = document.createElement("canvas");
  outCanvas.width = W; outCanvas.height = H;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("no out ctx");
  const outImg = outCtx.createImageData(W, H);

  // 출력을 MESH_N×MESH_N 셀로 분할, 각 셀마다 별도 perspective transform
  for (let r = 0; r < MESH_N; r++) {
    for (let c = 0; c < MESH_N; c++) {
      const dstX0 = Math.round((c / MESH_N) * W);
      const dstY0 = Math.round((r / MESH_N) * H);
      const dstX1 = Math.round(((c + 1) / MESH_N) * W);
      const dstY1 = Math.round(((r + 1) / MESH_N) * H);
      const cellW = dstX1 - dstX0;
      const cellH = dstY1 - dstY0;

      // 출력 셀(0,0)→(cellW,0)→(cellW,cellH)→(0,cellH) 가 source 의 mesh 사각형으로 매핑
      const M = getPerspectiveTransform(
        [{ x: 0, y: 0 }, { x: cellW, y: 0 }, { x: cellW, y: cellH }, { x: 0, y: cellH }],
        [m[r][c], m[r][c + 1], m[r + 1][c + 1], m[r + 1][c]],
      );
      warpRegion(src.data, sw, sh, outImg.data, W, dstX0, dstY0, cellW, cellH, M);
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  enhanceContrast(outCtx, W, H);
  return await canvasToFile(outCanvas, mimeType, fileName);
}

// ─────────── 공용 유틸 ───────────

async function loadSourceImageData(imgUrl: string, imgSize: { w: number; h: number }) {
  const img = await loadImage(imgUrl);
  const canvas = document.createElement("canvas");
  canvas.width = imgSize.w;
  canvas.height = imgSize.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d ctx");
  ctx.drawImage(img, 0, 0);
  return { src: ctx.getImageData(0, 0, imgSize.w, imgSize.h), sw: imgSize.w, sh: imgSize.h };
}

// 출력 데이터의 (dstX0..dstX0+regW, dstY0..dstY0+regH) 영역을 M 으로 source 에서 샘플링
function warpRegion(
  sd: Uint8ClampedArray, sw: number, sh: number,
  od: Uint8ClampedArray, outStrideW: number,
  dstX0: number, dstY0: number, regW: number, regH: number,
  M: number[],
) {
  const m0 = M[0], m1 = M[1], m2 = M[2], m3 = M[3], m4 = M[4], m5 = M[5], m6 = M[6], m7 = M[7];
  for (let dy = 0; dy < regH; dy++) {
    for (let dx = 0; dx < regW; dx++) {
      const denom = m6 * dx + m7 * dy + 1;
      const sx = (m0 * dx + m1 * dy + m2) / denom;
      const sy = (m3 * dx + m4 * dy + m5) / denom;
      const ix = sx | 0, iy = sy | 0;
      const oi = ((dstY0 + dy) * outStrideW + (dstX0 + dx)) * 4;
      if (ix >= 0 && ix < sw - 1 && iy >= 0 && iy < sh - 1) {
        const fx = sx - ix, fy = sy - iy;
        const i00 = (iy * sw + ix) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + sw * 4;
        const i11 = i01 + 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        od[oi]     = sd[i00]     * w00 + sd[i10]     * w10 + sd[i01]     * w01 + sd[i11]     * w11;
        od[oi + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
        od[oi + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
        od[oi + 3] = 255;
      } else {
        od[oi + 3] = 255;
      }
    }
  }
}

async function canvasToFile(canvas: HTMLCanvasElement, mimeType: string, fileName: string): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob null"))), mimeType, 0.92);
  });
  const safeName = fileName.replace(/(\.[^.]+)?$/, "_scanned$1");
  return new File([blob], safeName, { type: mimeType });
}

function enhanceContrast(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const contrast = 1.25;
  const intercept = 128 * (1 - contrast);
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = clamp(d[i]     * contrast + intercept);
    d[i + 1] = clamp(d[i + 1] * contrast + intercept);
    d[i + 2] = clamp(d[i + 2] * contrast + intercept);
  }
  ctx.putImageData(imgData, 0, 0);
}

function clamp(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// 4점 perspective transform: 8x8 선형 시스템 풀이
function getPerspectiveTransform(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const sx = src[i].x, sy = src[i].y;
    const dx = dst[i].x, dy = dst[i].y;
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); B.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); B.push(dy);
  }
  return solve8(A, B);
}

function solve8(A: number[][], B: number[]): number[] {
  const n = 8;
  const M: number[][] = A.map((row, i) => [...row, B[i]]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    }
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) throw new Error("singular");
    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
