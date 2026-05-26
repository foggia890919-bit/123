"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "./types";

export default function NoticesTab() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("공지");
  const [isPinned, setIsPinned] = useState(false);
  const [showAsPopup, setShowAsPopup] = useState(false);
  const [popupUntil, setPopupUntil] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const r = await fetch("/api/notices");
    const d = await r.json();
    setNotices(Array.isArray(d) ? d : []);
  }
  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) { setError("제목과 내용을 입력하세요"); return; }
    setLoading(true); setError("");
    const r = await fetch("/api/notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, category, isPinned, showAsPopup, popupUntil: popupUntil || null }),
    });
    if (r.ok) {
      setTitle(""); setContent(""); setIsPinned(false); setCategory("공지");
      setShowAsPopup(false); setPopupUntil("");
      await load();
    } else {
      const d = await r.json();
      setError(d.error || "등록 실패");
    }
    setLoading(false);
  }

  async function remove(id: string) {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch("/api/notices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await load();
  }

  async function togglePopup(n: Notice) {
    await fetch(`/api/notices/${n.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showAsPopup: !n.showAsPopup }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      {/* 등록 폼 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="font-semibold text-gray-800 mb-4">공지사항 등록</h3>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-28">
              {["공지", "업데이트", "안내", "이벤트"].map((c) => <option key={c}>{c}</option>)}
            </select>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-0" />
            <label className="flex items-center gap-1.5 text-sm text-gray-600 whitespace-nowrap cursor-pointer">
              <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} className="rounded" />
              필독 고정
            </label>
          </div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="내용"
            rows={4} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
          <div className="flex gap-4 items-center flex-wrap">
            <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={showAsPopup} onChange={(e) => setShowAsPopup(e.target.checked)} className="rounded" />
              팝업으로 노출
            </label>
            {showAsPopup && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">팝업 종료일:</span>
                <input type="date" value={popupUntil} onChange={e => setPopupUntil(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
                <span className="text-xs text-gray-400">(비워두면 무기한)</span>
              </div>
            )}
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "등록 중..." : "공지 등록"}
          </Button>
        </form>
      </div>

      {/* 목록 */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <span className="text-sm font-semibold text-gray-700">등록된 공지사항 ({notices.length}건)</span>
        </div>
        {notices.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-8">등록된 공지사항이 없습니다.</p>
        ) : (
          notices.map((n) => (
            <div key={n.id} className="border-b border-gray-100 last:border-0 px-5 py-3 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{n.category}</span>
                  {n.isPinned && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-medium">필독</span>}
                  {n.showAsPopup && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 font-medium">팝업</span>}
                  <span className="text-sm font-medium text-gray-800 truncate">{n.title}</span>
                </div>
                <p className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleDateString("ko-KR")}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => togglePopup(n)}
                  className={`text-xs px-2 py-1 rounded border ${n.showAsPopup ? "border-orange-300 text-orange-600 hover:border-orange-400" : "border-gray-200 text-gray-400 hover:border-gray-300"}`}>
                  {n.showAsPopup ? "팝업끄기" : "팝업켜기"}
                </button>
                <button onClick={() => remove(n.id)}
                  className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded px-2 py-1">
                  삭제
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 제출처(법인) 관리 탭
// ─────────────────────────────────────────────
