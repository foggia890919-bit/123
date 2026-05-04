"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Check, RotateCcw } from "lucide-react";

interface Point { x: number; y: number }
type Corners = [Point, Point, Point, Point]; // TL, TR, BR, BL (normalized 0-1)

interface Props {
  file: File;
  onConfirm: (correctedFile: File) => void;
  onSkip: () => void;
  onCancel: () => void;
}

export default function DocumentScanner({ file, onConfirm, onSkip, onCancel }: Props) {
  const [imgUrl, setImgUrl] = useState<string>("");
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [corners, setCorners] = useState<Corners>([
    { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 },
    { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 },
  ]);
  const [dragging, setDragging] = useState<number | null>(null);
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

  useEffect(() => {
    if (dragging === null) return;
    const move = (e: PointerEvent) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      setCorners((prev) => {
        const next = [...prev] as Corners;
        next[dragging] = { x, y };
        return next;
      });
    };
    const up = () => setDragging(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging]);

  function resetCorners() {
    setCorners([
      { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 },
    ]);
  }

  async function handleConfirm() {
    if (!imgSize) return;
    setBusy(true);
    try {
      const corrected = await applyPerspective(imgUrl, corners, imgSize, file.type || "image/jpeg", file.name);
      onConfirm(corrected);
    } catch (e) {
      console.error("[Scanner] perspective failed", e);
      onConfirm(file); // fallback to original
    } finally {
      setBusy(false);
    }
  }

  // Polygon path string (SVG)
  const polyPath = corners.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x * 100} ${c.y * 100}`).join(" ") + " Z";

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <div className="flex items-center justify-between mb-3 text-white">
          <div>
            <h2 className="text-base font-semibold">캠스캐너 보정</h2>
            <p className="text-xs text-gray-300">표 영역 4 모서리를 드래그해서 맞춘 뒤 보정하세요</p>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-white/10 rounded" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div ref={overlayRef} className="relative w-full bg-gray-900 rounded-lg overflow-hidden select-none touch-none"
             style={{ maxHeight: "70vh" }}>
          {imgUrl && (
            <img ref={imgRef} src={imgUrl} onLoad={onImgLoad} alt="원본"
                 className="block w-full h-auto max-h-[70vh] object-contain pointer-events-none" />
          )}
          <svg className="absolute inset-0 w-full h-full pointer-events-none"
               viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d={polyPath} fill="rgba(59,130,246,0.15)" stroke="rgb(59,130,246)" strokeWidth="0.4"
                  vectorEffect="non-scaling-stroke" />
          </svg>
          {corners.map((c, i) => (
            <button key={i}
              onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDragging(i); }}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border-2 border-blue-500 shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
              style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
              aria-label={`코너 ${i + 1}`}>
              <span className="block w-2 h-2 rounded-full bg-blue-500" />
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
          <div className="flex gap-2">
            <button onClick={resetCorners} disabled={busy}
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

// ------------------- Perspective transform (pure Canvas) -------------------

async function applyPerspective(
  imgUrl: string,
  cornersNorm: Corners,
  imgSize: { w: number; h: number },
  mimeType: string,
  fileName: string,
): Promise<File> {
  const c = cornersNorm.map((p) => ({ x: p.x * imgSize.w, y: p.y * imgSize.h }));
  // Output dimensions: max of opposing edge lengths
  const widthTop = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
  const widthBot = Math.hypot(c[2].x - c[3].x, c[2].y - c[3].y);
  const heightLeft = Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y);
  const heightRight = Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y);
  // Cap output to avoid huge canvases
  const W = Math.min(2400, Math.round(Math.max(widthTop, widthBot)));
  const H = Math.min(2400, Math.round(Math.max(heightLeft, heightRight)));

  // Map output rect → input quadrilateral, so for each output (x,y) we get source (sx,sy)
  const M = getPerspectiveTransform(
    [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
    c,
  );

  const img = await loadImage(imgUrl);
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = imgSize.w;
  srcCanvas.height = imgSize.h;
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) throw new Error("no 2d ctx");
  srcCtx.drawImage(img, 0, 0);
  const src = srcCtx.getImageData(0, 0, imgSize.w, imgSize.h);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = W;
  outCanvas.height = H;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("no out ctx");
  const outImg = outCtx.createImageData(W, H);

  const sw = imgSize.w, sh = imgSize.h;
  const sd = src.data, od = outImg.data;
  const m0 = M[0], m1 = M[1], m2 = M[2], m3 = M[3], m4 = M[4], m5 = M[5], m6 = M[6], m7 = M[7];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const denom = m6 * x + m7 * y + 1;
      const sx = (m0 * x + m1 * y + m2) / denom;
      const sy = (m3 * x + m4 * y + m5) / denom;
      const ix = sx | 0, iy = sy | 0;
      const oi = (y * W + x) * 4;
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
        od[oi + 3] = 255; // black
      }
    }
  }
  outCtx.putImageData(outImg, 0, 0);

  // Light contrast/brightness boost — helps OCR on dim photos
  enhanceContrast(outCtx, W, H);

  const blob = await new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob null"))), mimeType, 0.92);
  });
  const safeName = fileName.replace(/(\.[^.]+)?$/, "_scanned$1");
  return new File([blob], safeName, { type: mimeType });
}

function enhanceContrast(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  // Simple linear stretch: boost contrast around midpoint
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

// 4-point perspective transform: solve 8x8 linear system
// x' = (a*x + b*y + c) / (g*x + h*y + 1)
// y' = (d*x + e*y + f) / (g*x + h*y + 1)
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
