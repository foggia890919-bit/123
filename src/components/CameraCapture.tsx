"use client";

import { useEffect, useRef, useState } from "react";
import { X, Camera, RotateCw } from "lucide-react";

interface Props {
  onCapture: (file: File) => void;
  onCancel: () => void;
  /** Called when getUserMedia fails (no webcam, denied, etc.) so caller can fall back to native file picker. */
  onUnsupported?: () => void;
}

/**
 * Live camera preview using getUserMedia.
 * - Desktop: shows webcam in a modal with a 촬영 button.
 * - Mobile: tries rear camera (facingMode: "environment"). Most modern mobile browsers honor it.
 * - If getUserMedia is unavailable or denied, calls onUnsupported() and self-closes.
 */
export default function CameraCapture({ onCapture, onCancel, onUnsupported }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string>("");
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let active: MediaStream | null = null;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia 미지원 브라우저");
        // Try requested facingMode first; fall back to any camera.
        let s: MediaStream;
        try {
          s = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facingMode }, width: { ideal: 2560 }, height: { ideal: 1920 } },
            audio: false,
          });
        } catch {
          s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        active = s;
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        // Slight delay so user can see the message before fallback
        setTimeout(() => onUnsupported?.(), 1200);
      }
    }
    start();

    return () => {
      cancelled = true;
      active?.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode, onUnsupported]);

  function flip() {
    setFacingMode((m) => (m === "environment" ? "user" : "environment"));
  }

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) return;
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      // Stop stream before passing the file up — caller will open scanner modal next.
      stream?.getTracks().forEach((t) => t.stop());
      onCapture(file);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white bg-black/60">
        <div>
          <h2 className="text-base font-semibold">카메라 촬영</h2>
          <p className="text-xs text-gray-300">처방전을 화면 안에 담은 뒤 촬영 버튼을 누르세요</p>
        </div>
        <button onClick={onCancel} className="p-1 hover:bg-white/10 rounded" aria-label="닫기">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted
               className="max-w-full max-h-full object-contain bg-black" />
        {error && (
          <div className="absolute inset-x-4 top-4 bg-red-500/90 text-white text-sm rounded p-3">
            카메라를 열 수 없어요: {error}
            <br />
            <span className="text-xs">파일 선택 모드로 전환됩니다…</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 px-4 py-5 bg-black/70">
        <button onClick={flip} disabled={busy || !stream}
                className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 text-white rounded inline-flex items-center gap-1 disabled:opacity-50">
          <RotateCw className="w-3.5 h-3.5" /> 카메라 전환
        </button>
        <button onClick={capture} disabled={busy || !stream}
                className="px-6 py-3 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-full inline-flex items-center gap-2 disabled:opacity-50 font-semibold shadow-lg">
          <Camera className="w-5 h-5" /> {busy ? "촬영 중..." : "촬영"}
        </button>
      </div>
    </div>
  );
}
