"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Check, RotateCcw, Pencil, Square, Grid3x3 } from "lucide-react";

interface Point { x: number; y: number }
type Corners = [Point, Point, Point, Point]; // TL, TR, BR, BL (normalized 0-1)
type Mesh = Point[][]; // mesh[row][col], size (N+1) × (N+1)

type Mode = "corners" | "polygon" | "grid";
type GridSize = 3 | 4 | 5 | 6;

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

// 격자 모드 — corners 외곽 4점에 맞춰 (N+1)×(N+1) 격자 점을 bilinear 보간으로 생성
function defaultMesh(corners: Corners, n: number): Mesh {
  const tl = corners[0], tr = corners[1], br = corners[2], bl = corners[3];
  const grid: Mesh = [];
  for (let r = 0; r <= n; r++) {
    const tr_ = r / n;
    const left = { x: tl.x + (bl.x - tl.x) * tr_, y: tl.y + (bl.y - tl.y) * tr_ };
    const right = { x: tr.x + (br.x - tr.x) * tr_, y: tr.y + (br.y - tr.y) * tr_ };
    const row: Point[] = [];
    for (let c = 0; c <= n; c++) {
      const tc = c / n;
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
  // 다각형 모드: 가변 길이의 점 배열. 처음엔 빈 배열로 시작 — 사용자가 클릭으로 추가
  const [polygon, setPolygon] = useState<Point[]>([]);
  // 격자(펴기) 모드: (gridSize+1)² 개 점, perspective transform 으로 piecewise 펴기
  const [gridSize, setGridSize] = useState<GridSize>(4);
  const [mesh, setMesh] = useState<Mesh>(() => defaultMesh(defaultCorners(), 4));
  const [dragging, setDragging] = useState<{ kind: Mode; idx: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // 점 핸들 위에서 mousedown 이 일어났는지 추적 — 그러면 컨테이너 click 으로
  // 점 추가가 일어나지 않도록 차단 (드래그 시작과 점 추가가 충돌하는 문제)
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

  function switchMode(next: Mode) {
    if (next === "polygon" && polygon.length === 0) {
      setPolygon([]);
    }
    if (next === "grid") {
      // 격자 모드 진입 시 corners 기반으로 mesh 초기화
      setMesh(defaultMesh(corners, gridSize));
    } else if (mode === "grid" && next === "corners") {
      // 격자 → 코너: 외곽 4점만 가져옴
      setCorners([
        mesh[0][0], mesh[0][gridSize],
        mesh[gridSize][gridSize], mesh[gridSize][0],
      ]);
    }
    setMode(next);
  }

  function changeGridSize(n: GridSize) {
    setGridSize(n);
    // 외곽 4점 보존, 내부 점은 보간으로 재생성
    const outer: Corners = [
      mesh[0][0], mesh[0][mesh[0].length - 1],
      mesh[mesh.length - 1][mesh[mesh.length - 1].length - 1], mesh[mesh.length - 1][0],
    ];
    setMesh(defaultMesh(outer, n));
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
      } else if (dragging.kind === "polygon") {
        setPolygon((prev) => {
          const next = prev.slice();
          next[dragging.idx] = { x, y };
          return next;
        });
      } else {
        // grid
        const stride = gridSize + 1;
        const r = Math.floor(dragging.idx / stride);
        const c = dragging.idx % stride;
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

  // 키보드 입력 — Esc 로 다각형 마무리(보정 적용), Backspace 로 마지막 점 제거
  useEffect(() => {
    if (mode !== "polygon") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (polygon.length >= 3 && !busy && imgSize) {
          handleConfirm();
        } else if (polygon.length < 3) {
          // 점이 부족할 땐 모달 닫기 동작
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
    else if (mode === "polygon") setPolygon([]);
    else setMesh(defaultMesh(defaultCorners(), gridSize));
  }

  async function handleConfirm() {
    if (!imgSize) return;
    if (mode === "polygon" && polygon.length < 3) return;
    setBusy(true);
    try {
      let corrected: File;
      if (mode === "corners") {
        corrected = await applyPerspective(imgUrl, corners, imgSize, file.type || "image/jpeg", file.name);
      } else if (mode === "polygon") {
        corrected = await applyPolygonCrop(imgUrl, polygon, imgSize, file.type || "image/jpeg", file.name);
      } else {
        corrected = await applyMeshPerspective(imgUrl, mesh, gridSize, imgSize, file.type || "image/jpeg", file.name);
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
    let pts: Point[];
    if (mode === "corners") pts = corners;
    else if (mode === "polygon") pts = polygon;
    else {
      // grid: 외곽 path = 위 행 → 우측 열(중간 점만) → 아래 행 reverse → 좌측 열(중간 점만) reverse
      pts = [
        ...mesh[0],
        ...Array.from({ length: gridSize - 1 }, (_, i) => mesh[i + 1][gridSize]),
        ...mesh[gridSize].slice().reverse(),
        ...Array.from({ length: gridSize - 1 }, (_, i) => mesh[gridSize - 1 - i][0]),
      ];
    }
    if (pts.length === 0) return "";
    return pts.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x * 100} ${c.y * 100}`).join(" ") + (pts.length >= 3 ? " Z" : "");
  })();

  // 격자 모드: 내부 격자 선
  const meshLines: string[] = [];
  if (mode === "grid") {
    for (let r = 0; r <= gridSize; r++) {
      const row = mesh[r];
      meshLines.push(row.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * 100} ${p.y * 100}`).join(" "));
    }
    for (let c = 0; c <= gridSize; c++) {
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
                : mode === "polygon"
                  ? "꾸겨진 종이 외곽을 따라 점을 클릭해서 찍어주세요. 다 찍으면 Esc 로 마무리 (Backspace 로 마지막 점 취소)"
                  : `${gridSize}×${gridSize} 격자 점을 종이 표면에 맞춰 끌어주세요. 셀마다 별도로 펴짐.`}
            </p>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-white/10 rounded" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 모드 토글 */}
        <div className="flex flex-wrap gap-3 mb-3 items-center">
          <div className="flex gap-1 bg-white/10 rounded-md p-1 w-fit">
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
              onClick={() => switchMode("polygon")}
              disabled={busy}
              className={`px-3 py-1.5 text-xs rounded inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                mode === "polygon" ? "bg-white text-gray-900 font-medium" : "text-white/80 hover:bg-white/10"
              }`}
            >
              <Pencil className="w-3.5 h-3.5" /> 꾸겨짐 (다각형 자르기)
            </button>
            <button
              onClick={() => switchMode("grid")}
              disabled={busy}
              className={`px-3 py-1.5 text-xs rounded inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                mode === "grid" ? "bg-white text-gray-900 font-medium" : "text-white/80 hover:bg-white/10"
              }`}
            >
              <Grid3x3 className="w-3.5 h-3.5" /> 격자 (펴기)
            </button>
          </div>
          {mode === "grid" && (
            <div className="flex gap-1 bg-white/5 rounded-md p-1 items-center text-[11px] text-white/80">
              <span className="px-2">격자 크기</span>
              {([3, 4, 5, 6] as GridSize[]).map((n) => (
                <button key={n}
                  onClick={() => changeGridSize(n)}
                  disabled={busy}
                  className={`px-2.5 py-1 rounded transition-colors disabled:opacity-50 ${
                    gridSize === n ? "bg-white text-gray-900 font-medium" : "hover:bg-white/10"
                  }`}>
                  {n}×{n}
                </button>
              ))}
            </div>
          )}
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
              {meshLines.map((d, i) => (
                <path key={i} d={d} fill="none" stroke="rgba(59,130,246,0.55)" strokeWidth="0.25"
                      vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            {/* corners 모드 핸들 */}
            {mode === "corners" && corners.map((c, i) => (
              <button key={`c-${i}`}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDragging({ kind: "corners", idx: i }); }}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border-2 border-blue-500 shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
                aria-label={`코너 ${i + 1}`}>
                <span className="block w-2 h-2 rounded-full bg-blue-500" />
              </button>
            ))}
            {/* polygon 모드 핸들 */}
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
            {/* grid 모드 핸들 */}
            {mode === "grid" && mesh.flatMap((row, r) =>
              row.map((p, c) => {
                const idx = r * (gridSize + 1) + c;
                const isCorner = (r === 0 || r === gridSize) && (c === 0 || c === gridSize);
                return (
                  <button key={`g-${idx}`}
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDragging({ kind: "grid", idx }); }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white border-2 shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing touch-none ${
                      isCorner ? "w-7 h-7 border-blue-600" : "w-5 h-5 border-blue-400"
                    }`}
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                    aria-label={`grid ${r},${c}`}>
                    <span className={`block rounded-full bg-blue-500 ${isCorner ? "w-2 h-2" : "w-1.5 h-1.5"}`} />
                  </button>
                );
              }),
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
          <div className="flex gap-2 items-center">
            <button onClick={reset} disabled={busy}
                    className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 text-white rounded inline-flex items-center gap-1 disabled:opacity-50">
              <RotateCcw className="w-3.5 h-3.5" /> 초기화
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
            {mode === "grid" && (
              <span className="text-[11px] text-gray-300 ml-1">
                {(gridSize + 1) ** 2}개 점을 종이 표면 격자에 끌어맞추세요
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

// ─────────── Polygon crop (꾸겨진 종이용) ───────────
//
// 사용자가 찍은 점들로 다각형을 만들고, 그 다각형 안쪽만 살리고 바깥은 흰색으로 마스킹.
// 출력 사이즈 = 다각형 bounding box. 보간/펴기는 안 함 — 꾸겨진 안쪽 글자는 그대로
// 두지만 OCR 정확도를 떨어트리는 배경 잡음/그림자 영역은 제거.
async function applyPolygonCrop(
  imgUrl: string,
  polygonNorm: Point[],
  imgSize: { w: number; h: number },
  mimeType: string,
  fileName: string,
): Promise<File> {
  const pts = polygonNorm.map((p) => ({ x: p.x * imgSize.w, y: p.y * imgSize.h }));
  // bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  // 캔버스 크기 캡 (큰 사진은 다운스케일)
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

  // 흰 배경 (다각형 바깥)
  outCtx.fillStyle = "#ffffff";
  outCtx.fillRect(0, 0, W, H);

  // 다각형 영역만 클립
  outCtx.save();
  outCtx.beginPath();
  pts.forEach((p, i) => {
    const x = (p.x - minX) * scale;
    const y = (p.y - minY) * scale;
    if (i === 0) outCtx.moveTo(x, y); else outCtx.lineTo(x, y);
  });
  outCtx.closePath();
  outCtx.clip();

  // 다운스케일 비율로 원본 그리기
  outCtx.drawImage(img,
    minX, minY, rawW, rawH,
    0, 0, W, H,
  );
  outCtx.restore();

  enhanceContrast(outCtx, W, H);
  return await canvasToFile(outCanvas, mimeType, fileName);
}

// ─────────── Mesh perspective (펴기, 가변 크기) ───────────
//
// (N+1)×(N+1) 격자를 N×N = N² 셀로 나눠 셀마다 별도 perspective transform.
// 격자가 촘촘할수록 꾸겨짐 흡수 효과 ↑.
async function applyMeshPerspective(
  imgUrl: string,
  meshNorm: Mesh,
  n: number,
  imgSize: { w: number; h: number },
  mimeType: string,
  fileName: string,
): Promise<File> {
  const m: Point[][] = meshNorm.map((row) => row.map((p) => ({ x: p.x * imgSize.w, y: p.y * imgSize.h })));

  const tl = m[0][0], tr = m[0][n], br = m[n][n], bl = m[n][0];
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

  // 출력 사각형을 N×N 셀로 분할
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const dstX0 = Math.round((c / n) * W);
      const dstY0 = Math.round((r / n) * H);
      const dstX1 = Math.round(((c + 1) / n) * W);
      const dstY1 = Math.round(((r + 1) / n) * H);
      const cellW = dstX1 - dstX0;
      const cellH = dstY1 - dstY0;

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
