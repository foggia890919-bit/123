"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";

export default function SyncSheetsButton() {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true); setError(null); setUrl(null);
    try {
      const res = await fetch("/api/admin/sync-sheets", { method: "POST" });
      let data: { url?: string; error?: string };
      try {
        data = await res.json();
      } catch {
        data = { error: `HTTP ${res.status} — 응답이 JSON이 아님 (라우트 미배포 가능성)` };
      }
      if (data.url) setUrl(data.url);
      else setError(data.error ?? "오류 발생");
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        onClick={handleSync}
        disabled={loading}
        className="w-full flex items-center gap-2 text-sm text-emerald-700 hover:text-emerald-900 border border-emerald-200 hover:border-emerald-400 rounded-md px-2.5 py-2 transition-colors disabled:opacity-50"
      >
        <FileSpreadsheet className="w-4 h-4" />
        {loading ? "동기화 중…" : "Google Sheets 동기화"}
      </button>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="block text-center text-xs text-emerald-600 underline truncate px-1"
        >
          시트 열기
        </a>
      )}
      {error && <p className="text-xs text-red-500 px-1">{error}</p>}
    </div>
  );
}
