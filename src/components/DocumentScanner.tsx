"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Check, RotateCcw, RotateCw, Pencil, Square, Info } from "lucide-react";
import { detectDocument } from "./documentDetect";

interface Point { x: number; y: number }
type Corners = [Point, Point, Point, Point]; // TL, TR, BR, BL (normalized 0-1)

type Mode = "corners" | "polygon";
type AutoStatus = "idle" | "detecting" | "done" | "failed";
type Rotation = 0 | 90 | 180 | 270;

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

export default function DocumentScanner({ file, onConfirm, onSkip, onCancel }: Props) {
  const [imgUrl, setImgUrl] = useState<string>("");
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [mode, setMode] = useState<Mode>("corners");
  const [corners, setCorners] = useState<Corners>(defaultCorners());
  // 다각형 모드: 가변 길이의 점 배열. 처음엔 빈 배열로 시작 — 사용자가 클릭으로 추가
  const [polygon, setPolygon] = useState<Point[]>([]);
  const [dragging, setDragging] = useState<{ kind: Mode; idx: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // 자동 감지 상태 + 출력 회전. 미리보기는 회전하지 않고 최종 출력에만 적용해
  // 코너 좌표계 정합을 안전하게 유지한다.
  const [autoStatus, setAutoStatus] = useState<AutoStatus>("idle");
  const [rotation, setRotation] = useState<Rotation>(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // 점 핸들 위에서 mousedown 이 일어났는지 추적 — 그러면 컨테이너 click 으로 점 추가가 일어나지 않도록 차단
  const justGrabbedHandle = useRef(false);

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

  // 모달 오픈 시 1회 자동 감지. 무거운 작업(OpenCV 로드/컴파일/감지)은 전부 워커
  // 안에서 일어나므로 메인 스레드는 절대 블로킹되지 않는다. 감지가 끝나기 전에도
  // 코너 드래그·모드 전환·모든 버튼 조작이 즉시 가능하며, 결과가 오면 반영만 한다.
  // requestIdleCallback(폴백 setTimeout)으로 UI 가 먼저 렌더된 뒤 시작한다.
  useEffect(() => {
    if (!imgUrl || !imgSize) return;
    let cancelled = false;
    setAutoStatus("detecting");

    const run = () => {
      detectDocument(imgUrl, imgSize)
        .then((res) => {
          if (cancelled) return;
          if (res.corners) setCorners(res.corners);
          if (res.shouldRotate) setRotation(90);
          setAutoStatus(res.corners ? "done" : "failed");
        })
        .catch(() => {
          if (!cancelled) setAutoStatus("failed");
        });
    };

    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (typeof ric === "function") {
      idleId = ric(run, { timeout: 500 });
    } else {
      timeoutId = setTimeout(run, 60);
    }

    return () => {
      cancelled = true;
      const cic = (window as unknown as {
        cancelIdleCallback?: (id: number) => void;
      }).cancelIdleCallback;
      if (idleId !== null && typeof cic === "function") cic(idleId);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
    // imgUrl/imgSize 준비 시 1회. 파일 변경으로 둘 다 바뀌면 재실행.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgUrl, imgSize]);

  function switchMode(next: Mode) {
    if (next === "polygon" && polygon.length === 0) setPolygon([]);
    setMode(next);
  }

  // 드래그 처리
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
        setPolygon((prev) => {
          const next = prev.slice();
          next[dragging.idx] = { x, y };
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

  // 키보드 — Esc 로 다각형 마무리, Backspace 로 마지막 점 제거
  useEffect(() => {
    if (mode !== "polygon") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (polygon.length >= 3 && !busy && imgSize) {
          handleConfirm();
        } else if (polygon.length < 3) {
          onCancel();
        }
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        setPolygon((p) => p.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, polygon.length, busy, imgSize]);

  // 다각형 모드: 빈 영역 클릭 시 점 추가
  function onOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (mode !== "polygon") return;
    if (justGrabbedHandle.current) { justGrabbedHandle.current = false; return; }
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPolygon((p) => [...p, { x, y }]);
  }

  function reset() {
    if (mode === "corners") setCorners(defaultCorners());
    else setPolygon([]);
  }

  async function handleConfirm() {
    if (!imgSize) return;
    if (mode === "polygon" && polygon.length < 3) return;
    setBusy(true);
    try {
      let corrected: File;
      if (mode === "corners") {
        corrected = await applyPerspective(imgUrl, corners, imgSize, file.type || "image/jpeg", file.name, rotation);
      } else {
        corrected = await applyPolygonCrop(imgUrl, polygon, imgSize, file.type || "image/jpeg", file.name, rotation);
      }
      onConfirm(corrected);
    } catch (e) {
      console.error("[Scanner] warp failed", e);
      onConfirm(file); // fallback to original
    } finally {
      setBusy(false);
    }
  }

  // 외곽선 path
  const polyPath = (() => {
    const pts = mode === "corners" ? corners : polygon;
    if (pts.length === 0) return "";
    return pts.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x * 100} ${c.y * 100}`).join(" ") + (pts.length >= 3 ? " Z" : "");
  })();

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <div className="flex items-center justify-between mb-3 text-white">
          <div>
            <h2 className="text-base font-semibold">캠스캐너 보정</h2>
            <p className="text-xs text-gray-300">
              {mode === "corners"
                ? "표 영역 4 모서리를 드래그해서 맞춘 뒤 보정하세요"
                : "꾸겨진 종이 외곽을 따라 점을 클릭해서 찍어주세요. 다 찍으면 Esc 로 마무리 (Backspace 로 마지막 점 취소)"}
            </p>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-white/10 rounded" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 모드 토글 + 자동 감지 상태 */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex gap-1 bg-white/10 rounded-md p-1 w-fit">
            <button
              onClick={() => switchMode("corners")}
              disabled={busy}
              className={`px-3 py-1.5 text-xs rounded inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                mode === "corners" ? "bg-white text-gray-900 font-medium" : "text-white/80 hover:bg-white/10"
              }`}
            >
              <Square className="w-3.5 h-3.5" /> 평평 (4코너 펴기)
            </button>
            <button
              onClick={() => switchMode("polygon")}
              disabled={busy}
              className={`px-3 py-1.5 text-xs rounded inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                mode === "polygon" ? "bg-white text-gray-900 font-medium" : "text-white/80 hover:bg-white/10"
              }`}
            >
              <Pencil className="w-3.5 h-3.5" /> 외곽 자르기 (다각형)
            </button>
          </div>
          {autoStatus === "detecting" && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-blue-200">
              <span className="w-3 h-3 rounded-full border-2 border-blue-300/40 border-t-blue-300 animate-spin" />
              자동 감지 중... (조작은 지금 바로 가능)
            </span>
          )}
          {autoStatus === "done" && (
            <span className="text-[11px] text-emerald-300">
              문서 자동 감지됨 — 필요하면 코너 미세조정
            </span>
          )}
          {rotation !== 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded px-2 py-0.5">
              출력 시 {rotation}° 회전됨
            </span>
          )}
        </div>

        {/* 촬영 안내 — 꾸겨짐 펴기는 기술적 한계로 제거됨, 사용자에게 미리 안내 */}
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-400/30 rounded-md px-3 py-2 mb-3 text-[11px] text-amber-100">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p><b>촬영 팁</b>: 종이는 평평하게 펴서 빛이 잘 드는 곳에서 정면으로 찍으세요. 꾸겨짐·접힘 부분은 OCR 정확도를 크게 떨어뜨립니다.</p>
            <p>· <b>평평 모드</b>: 비스듬히 찍힌 평평한 종이를 정면으로 펴줍니다.</p>
            <p>· <b>외곽 자르기</b>: 종이 외곽을 따라 점을 찍어 배경·그림자만 제거합니다 (펴지지는 않음).</p>
          </div>
        </div>

        <div className="w-full bg-gray-900 rounded-lg overflow-auto flex items-center justify-center" style={{ maxHeight: "70vh" }}>
          <div ref={overlayRef} onClick={(e) => mode === "polygon" && onOverlayClick(e)}
               className={`relative inline-block select-none touch-none ${mode === "polygon" ? "cursor-crosshair" : ""}`}>
            {imgUrl && (
              <img ref={imgRef} src={imgUrl} onLoad={onImgLoad} alt="원본"
                   className="block max-w-full max-h-[70vh] pointer-events-none"
                   draggable={false} />
            )}
            <svg className="absolute inset-0 w-full h-full pointer-events-none"
                 viewBox="0 0 100 100" preserveAspectRatio="none">
              {polyPath && (
                <path d={polyPath} fill="rgba(59,130,246,0.15)" stroke="rgb(59,130,246)" strokeWidth="0.4"
                      vectorEffect="non-scaling-stroke" />
              )}
            </svg>
            {mode === "corners" && corners.map((c, i) => (
              <button key={`c-${i}`}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDragging({ kind: "corners", idx: i }); }}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border-2 border-blue-500 shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                aria-label={`코너 ${i + 1}`}>
                <span className="block w-2 h-2 rounded-full bg-blue-500" />
              </button>
            ))}
            {mode === "polygon" && polygon.map((p, i) => (
              <button key={`p-${i}`}
                onPointerDown={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  justGrabbedHandle.current = true;
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  setDragging({ kind: "polygon", idx: i });
                }}
                onContextMenu={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  setPolygon((arr) => arr.filter((_, j) => j !== i));
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white border-2 border-blue-500 shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing touch-none text-[9px] font-bold text-blue-600"
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                aria-label={`점 ${i + 1}`}>
                {i + 1}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
          <div className="flex gap-2 items-center">
            <button onClick={reset} disabled={busy}
                    className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 text-white rounded inline-flex items-center gap-1 disabled:opacity-50">
              <RotateCcw className="w-3.5 h-3.5" /> 초기화
            </button>
            <button onClick={() => setRotation((r) => ((r + 90) % 360) as Rotation)} disabled={busy}
                    className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 text-white rounded inline-flex items-center gap-1 disabled:opacity-50"
                    title="최종 출력 이미지를 90도 회전합니다 (미리보기는 그대로)">
              <RotateCw className="w-3.5 h-3.5" /> 90° 회전
            </button>
            <button onClick={onSkip} disabled={busy}
                    className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 text-white rounded disabled:opacity-50">
              보정 없이 사용
            </button>
            {mode === "polygon" && (
              <span className="text-[11px] text-gray-300 ml-1">
                {polygon.length === 0 ? "점을 찍어주세요" : `${polygon.length}점 — 우클릭으로 점 삭제, Backspace 로 마지막 점 취소`}
              </span>
            )}
          </div>
          <button onClick={handleConfirm}
                  disabled={busy || !imgSize || (mode === "polygon" && polygon.length < 3)}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded inline-flex items-center gap-1.5 disabled:opacity-50 font-medium">
            <Check className="w-4 h-4" /> {busy ? "보정 중..." : (mode === "polygon" ? "보정 적용 (Esc)" : "보정 적용")}
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
  rotation: Rotation = 0,
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
  // 가벼운 Canvas-only 대비 보정 — OpenCV 의존성 제거 (freeze 회피).
  // 본격적인 dewarping/denoise 는 서버측 Document AI 의 ML 이 담당.
  enhanceContrast(outCtx, W, H);
  return await canvasToFile(rotateCanvas(outCanvas, rotation), mimeType, fileName);
}

// ─────────── Polygon crop (외곽 자르기) ───────────

async function applyPolygonCrop(
  imgUrl: string,
  polygonNorm: Point[],
  imgSize: { w: number; h: number },
  mimeType: string,
  fileName: string,
  rotation: Rotation = 0,
): Promise<File> {
  const pts = polygonNorm.map((p) => ({ x: p.x * imgSize.w, y: p.y * imgSize.h }));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  const rawW = Math.max(1, Math.round(maxX - minX));
  const rawH = Math.max(1, Math.round(maxY - minY));
  const scale = Math.min(1, 2400 / Math.max(rawW, rawH));
  const W = Math.max(1, Math.round(rawW * scale));
  const H = Math.max(1, Math.round(rawH * scale));

  const img = await loadImage(imgUrl);
  const outCanvas = document.createElement("canvas");
  outCanvas.width = W; outCanvas.height = H;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("no out ctx");

  outCtx.fillStyle = "#ffffff";
  outCtx.fillRect(0, 0, W, H);

  outCtx.save();
  outCtx.beginPath();
  pts.forEach((p, i) => {
    const x = (p.x - minX) * scale;
    const y = (p.y - minY) * scale;
    if (i === 0) outCtx.moveTo(x, y); else outCtx.lineTo(x, y);
  });
  outCtx.closePath();
  outCtx.clip();

  outCtx.drawImage(img, minX, minY, rawW, rawH, 0, 0, W, H);
  outCtx.restore();

  enhanceContrast(outCtx, W, H);
  return await canvasToFile(rotateCanvas(outCanvas, rotation), mimeType, fileName);
}

// ─────────── 공용 유틸 ───────────

// enhanceContrast 이후 최종 캔버스만 회전. 90/270 은 W/H 스왑. 미리보기 좌표계와
// 무관하게 출력에만 적용된다. 최신 크롬은 drawImage 시 EXIF orientation 을 기본
// 반영하므로 EXIF 파서는 도입하지 않고, EXIF 없는 눕힘은 워커 휴리스틱 + 수동
// "90° 회전" 버튼으로 커버한다.
function rotateCanvas(canvas: HTMLCanvasElement, rotation: Rotation): HTMLCanvasElement {
  if (rotation === 0) return canvas;
  const w = canvas.width, h = canvas.height;
  const swap = rotation === 90 || rotation === 270;
  const out = document.createElement("canvas");
  out.width = swap ? h : w;
  out.height = swap ? w : h;
  const ctx = out.getContext("2d");
  if (!ctx) return canvas;
  ctx.save();
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  ctx.restore();
  return out;
}

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
