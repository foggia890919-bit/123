"use client";

import React, { useRef, useEffect, useState } from "react";
import { Upload, ZoomIn, ZoomOut, Maximize2, Minimize2, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OcrResult, ManualDrug } from "./types";

interface ImagePanelProps {
  imageUrl: string | null;
  imageFile: File | null;
  originalImageFile: File | null;
  selectedClient: { id: string } | null;
  ocrLoading: boolean;
  ocrError: string;
  ocr: OcrResult | null;
  editOcr: OcrResult | null;
  manualDrugs: ManualDrug[];
  focusedIdx: number | null;
  zoomLevel: number;
  setZoomLevel: React.Dispatch<React.SetStateAction<number>>;
  zoomEnabled: boolean;
  setZoomEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  isZoomed: boolean;
  setIsZoomed: React.Dispatch<React.SetStateAction<boolean>>;
  showDebug: boolean;
  setShowDebug: React.Dispatch<React.SetStateAction<boolean>>;
  imageHeight: number;
  setImageHeight: React.Dispatch<React.SetStateAction<number>>;
  imageScrollRef: React.RefObject<HTMLDivElement | null>;
  imageElRef: React.RefObject<HTMLImageElement | null>;
  onRunOcr: () => void;
  onFileSelect: () => void;
  onCameraOpen: () => void;
  onDrop: (e: React.DragEvent) => void;
  onReScan: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCameraInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function ImagePanel({
  imageUrl,
  imageFile,
  originalImageFile,
  selectedClient,
  ocrLoading,
  ocrError,
  ocr,
  editOcr,
  manualDrugs,
  focusedIdx,
  zoomLevel,
  setZoomLevel,
  zoomEnabled,
  setZoomEnabled,
  isZoomed,
  setIsZoomed,
  showDebug,
  setShowDebug,
  imageHeight,
  setImageHeight,
  imageScrollRef,
  imageElRef,
  onRunOcr,
  onFileSelect,
  onCameraOpen,
  onDrop,
  onReScan,
  fileInputRef,
  cameraInputRef,
  onFileInputChange,
  onCameraInputChange,
}: ImagePanelProps) {
  const isPanning = useRef<{ startX: number; startY: number; startScrollX: number; startScrollY: number } | null>(null);
  const dragMoved = useRef(false);
  const isDraggingResize = useRef(false);

  function handleImageClick() {
    if (dragMoved.current) return;
    if (!zoomEnabled) return;
    if (isZoomed) { setZoomLevel(100); setIsZoomed(false); }
    else { setZoomLevel(200); setIsZoomed(true); }
  }

  function handleImageMouseDown(e: React.MouseEvent) {
    const scrollEl = imageScrollRef.current;
    if (!scrollEl) return;
    isPanning.current = {
      startX: e.clientX,
      startY: e.clientY,
      startScrollX: scrollEl.scrollLeft,
      startScrollY: scrollEl.scrollTop,
    };
    dragMoved.current = false;
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const pan = isPanning.current;
      const scrollEl = imageScrollRef.current;
      if (!pan || !scrollEl) return;
      const dx = e.clientX - pan.startX;
      const dy = e.clientY - pan.startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragMoved.current = true;
      scrollEl.scrollLeft = pan.startScrollX - dx;
      scrollEl.scrollTop = pan.startScrollY - dy;
    }
    function onUp() { isPanning.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [imageScrollRef]);

  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    isDraggingResize.current = true;
    const startY = e.clientY;
    const startHeight = imageHeight;
    function onMove(ev: MouseEvent) {
      if (!isDraggingResize.current) return;
      const next = Math.max(200, Math.min(800, startHeight + (ev.clientY - startY)));
      setImageHeight(next);
    }
    function onUp() {
      isDraggingResize.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="sticky top-0 z-30 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-3 py-2 flex items-center gap-2 bg-gray-50 flex-wrap">
        <Button type="button" variant="outline" size="sm" onClick={onCameraOpen} className="text-xs">
          카메라
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onFileSelect} className="text-xs">
          <Upload className="w-3.5 h-3.5 mr-1" />파일 선택
        </Button>
        {(originalImageFile || imageFile) && (
          <Button type="button" variant="outline" size="sm"
                  onClick={onReScan}
                  className="text-xs bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-700">
            재보정
          </Button>
        )}
        {imageUrl && (
          <Button type="button" size="sm" onClick={onRunOcr} disabled={ocrLoading || !selectedClient}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300">
            <BarChart3 className="w-3.5 h-3.5 mr-1" />{ocrLoading ? "인식 중..." : "처방전 인식"}
          </Button>
        )}
        {imageUrl && !selectedClient && (
          <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded">
            ⓘ 거래처를 먼저 선택하세요
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {imageUrl && <>
            <button onClick={() => { setZoomLevel(100); setIsZoomed(false); }}
              className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 font-mono">1:1</button>
            <button onClick={() => setZoomLevel((z) => Math.min(z + 25, 400))}
              className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-100">
              <ZoomIn className="w-3.5 h-3.5" /></button>
            <button onClick={() => setZoomLevel((z) => Math.max(z - 25, 25))}
              className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-100">
              <ZoomOut className="w-3.5 h-3.5" /></button>
            <span className="text-xs text-gray-500 font-mono w-10 text-right">{zoomLevel}%</span>
          </>}
          {ocr && (
            <>
              <span className="text-xs text-gray-600">클릭 확대</span>
              <button onClick={() => { setZoomEnabled((v) => !v); if (isZoomed) { setIsZoomed(false); setZoomLevel(100); } }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${zoomEnabled ? "bg-blue-500" : "bg-gray-300"}`}>
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${zoomEnabled ? "translate-x-4" : "translate-x-1"}`} />
              </button>
              <span className="text-[10px] text-gray-500">
                {zoomEnabled ? (isZoomed ? <Minimize2 className="w-3 h-3 inline text-blue-500" /> : <Maximize2 className="w-3 h-3 inline text-blue-500" />) : null}
              </span>
              <span className="text-xs text-gray-600 ml-2">디버그</span>
              <button onClick={() => setShowDebug((v) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showDebug ? "bg-pink-500" : "bg-gray-300"}`}
                title="OCR 행 밴드와 매칭된 셀 위치를 이미지에 표시">
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${showDebug ? "translate-x-4" : "translate-x-1"}`} />
              </button>
            </>
          )}
          {ocrError && <p className="text-xs text-red-500">{ocrError}</p>}
        </div>
      </div>
      <div ref={imageScrollRef}
        onMouseDown={handleImageMouseDown}
        style={{ height: `${imageHeight}px` }}
        className="overflow-auto relative bg-gray-50"
      >
        {imageUrl ? (
          <div onClick={handleImageClick}
            className={`w-full min-h-full flex items-start justify-center p-2 select-none ${isPanning.current ? "cursor-grabbing" : zoomEnabled ? (isZoomed ? "cursor-zoom-out" : "cursor-zoom-in") : "cursor-grab"}`}>
            <div className="relative shrink-0"
              style={{ width: `${zoomLevel}%`, transition: "width 0.2s ease" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={imageElRef} src={imageUrl} alt="처방전"
                style={{ width: "100%", display: "block" }}
                className="rounded" draggable={false} />
              {/* 실좌표 bbox 하이라이트 — 포커스된 행의 사진 내 실제 위치를 상태색 박스로.
                  verified=초록 / mismatch=빨강 / unreadable=주황. 옛 방식(균등 간격 바) 제거됨.
                  실좌표 없는 행(직접 추가/옛 데이터)은 표시 안 함. */}
              {focusedIdx != null && (() => {
                const fd = manualDrugs[focusedIdx];
                const b = fd?.bbox;
                if (!b || !b.some((v) => v > 0)) return null;
                const st = fd?.rowStatus;
                const color = st === "mismatch" ? "#dc2626" : st === "unreadable" ? "#d97706" : "#16a34a";
                return (
                  <div
                    className="absolute pointer-events-none rounded-sm transition-all"
                    style={{
                      left: `${b[0] * 100}%`,
                      top: `${b[1] * 100}%`,
                      width: `${(b[2] - b[0]) * 100}%`,
                      height: `${(b[3] - b[1]) * 100}%`,
                      border: `2px solid ${color}`,
                      backgroundColor: `${color}26`,
                      boxShadow: "0 0 0 2px rgba(255,255,255,0.45)",
                    }}
                  />
                );
              })()}
              {showDebug && editOcr && (
                <svg className="absolute inset-0 pointer-events-none"
                  viewBox="0 0 100 100" preserveAspectRatio="none"
                  style={{ width: "100%", height: "100%" }}>
                  {editOcr.drugs.map((d, i) => {
                    if (!d.debug) return null;
                    const { anchorXPct, anchorTopPct, anchorBotPct, slopePerWidth, qtyBoxPct } = d.debug;
                    const xLeft = 0, xRight = 100;
                    const dxLeft = xLeft - anchorXPct * 100;
                    const dxRight = xRight - anchorXPct * 100;
                    const yTopLeft = anchorTopPct * 100 + slopePerWidth * (dxLeft / 100) * 100;
                    const yTopRight = anchorTopPct * 100 + slopePerWidth * (dxRight / 100) * 100;
                    const yBotLeft = anchorBotPct * 100 + slopePerWidth * (dxLeft / 100) * 100;
                    const yBotRight = anchorBotPct * 100 + slopePerWidth * (dxRight / 100) * 100;
                    const isFocus = focusedIdx === i;
                    const stroke = isFocus ? "#dc2626" : "#fb7185";
                    const op = isFocus ? 0.95 : 0.45;
                    return (
                      <g key={i} opacity={op}>
                        <line x1={xLeft} y1={yTopLeft} x2={xRight} y2={yTopRight}
                          stroke={stroke} strokeWidth={isFocus ? 0.25 : 0.12} vectorEffect="non-scaling-stroke" />
                        <line x1={xLeft} y1={yBotLeft} x2={xRight} y2={yBotRight}
                          stroke={stroke} strokeWidth={isFocus ? 0.25 : 0.12} vectorEffect="non-scaling-stroke" />
                        {qtyBoxPct && (
                          <rect
                            x={qtyBoxPct.left * 100}
                            y={qtyBoxPct.top * 100}
                            width={(qtyBoxPct.right - qtyBoxPct.left) * 100}
                            height={(qtyBoxPct.bottom - qtyBoxPct.top) * 100}
                            fill="none" stroke="#16a34a" strokeWidth={isFocus ? 0.4 : 0.2}
                            vectorEffect="non-scaling-stroke" />
                        )}
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>
          </div>
        ) : (
          <div onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
            className="h-full min-h-64 flex flex-col items-center justify-center gap-3 transition-colors m-4 border-2 border-dashed border-gray-300 rounded-lg p-4">
            <Upload className="w-10 h-10 text-gray-300" />
            <div className="text-center">
              <p className="text-sm font-medium text-gray-600">처방전 이미지 업로드</p>
              <p className="text-xs text-gray-400 mt-1">파일 선택 후 4 모서리 보정 (캠스캐너 방식)</p>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 max-w-md mx-auto">
                📷 촬영 팁: 종이를 <b>평평하게 펴서</b> 빛 잘 드는 곳에서 정면으로 찍으세요. 꾸겨짐·접힘은 OCR 정확도를 크게 떨어뜨립니다.
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              <Button type="button" size="sm" onClick={onCameraOpen}
                      className="bg-blue-600 hover:bg-blue-700 text-white">
                카메라 촬영
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onFileSelect}>
                앨범에서 선택
              </Button>
            </div>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
          onChange={onFileInputChange} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={onCameraInputChange} />
      </div>
      {/* 높이 조절 핸들 — 아래로 드래그 */}
      <div onMouseDown={handleResizeMouseDown}
        className="h-1.5 cursor-row-resize bg-gray-200 hover:bg-blue-400 transition-colors"
        title="드래그하여 높이 조절" />
    </div>
  );
}
