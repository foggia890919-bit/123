"use client";

import { useState, useEffect } from "react";
import { Plus, RefreshCw, Search, X } from "lucide-react";
import { SubmissionEntity } from "./types";

export default function SubmissionEntityTab() {
  const [rows, setRows] = useState<SubmissionEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editRow, setEditRow] = useState<(SubmissionEntity & { isNew?: boolean }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/submission-entities");
    const data = await res.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function save() {
    if (!editRow) return;
    const name = editRow.name.trim();
    if (!name) { alert("법인명은 필수에요."); return; }
    setSaving(true);
    const res = await fetch("/api/admin/submission-entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editRow),
    });
    if (res.ok) {
      const saved: SubmissionEntity = await res.json();
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.name === saved.name);
        return idx >= 0 ? prev.map((r, i) => i === idx ? saved : r) : [...prev, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      setEditRow(null);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(`저장 실패: ${data.error || "알 수 없는 오류"}`);
    }
    setSaving(false);
  }

  async function deleteRow(name: string) {
    if (!confirm(`"${name}" 제출처를 삭제할까요?`)) return;
    setDeletingName(name);
    await fetch("/api/admin/submission-entities", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRows((prev) => prev.filter((r) => r.name !== name));
    setDeletingName(null);
  }

  const filtered = rows.filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return r.name.toLowerCase().includes(q) ||
      (r.contactName || "").toLowerCase().includes(q) ||
      (r.email || "").toLowerCase().includes(q) ||
      (r.phone || "").includes(query);
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">제출처(법인) 관리</h2>
            <p className="text-xs text-gray-400 mt-0.5">필터링 요청을 접수하는 제출처(법인) 정보를 등록·관리합니다. 등록된 법인은 제약사별 제출처 연결 시 드롭다운으로 선택할 수 있어요.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="법인명 · 담당자 · 이메일"
                className="h-8 w-52 border border-gray-200 rounded pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <button onClick={load} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />새로고침
            </button>
            <button
              onClick={() => setEditRow({ name: "", contactName: null, email: null, phone: null, fax: null, notes: null, isNew: true })}
              className="h-8 px-3 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1.5"
            >
              <Plus className="w-3 h-3" />신규 등록
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            {query ? "검색 결과가 없어요." : "등록된 제출처가 없어요. 위 \"신규 등록\" 버튼으로 추가해 주세요."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                <th className="px-4 py-3 text-left">법인명</th>
                <th className="px-4 py-3 text-left">담당자</th>
                <th className="px-4 py-3 text-left">이메일</th>
                <th className="px-4 py-3 text-left">전화번호</th>
                <th className="px-4 py-3 text-left">팩스</th>
                <th className="px-4 py-3 text-left">비고</th>
                <th className="px-4 py-3 text-center w-[100px]">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => (
                <tr key={r.name} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{r.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.contactName || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-2.5 text-blue-600">{r.email ? <a href={`mailto:${r.email}`} className="hover:underline">{r.email}</a> : <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.phone || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-2.5 text-gray-500">{r.fax || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-2.5 text-gray-500 max-w-[160px] truncate">{r.notes || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setEditRow({ ...r })}
                        className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
                      >수정</button>
                      <button
                        onClick={() => deleteRow(r.name)}
                        disabled={deletingName === r.name}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 disabled:opacity-40"
                      >{deletingName === r.name ? "..." : "삭제"}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editRow && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{editRow.isNew ? "신규 제출처 등록" : `${editRow.name} 수정`}</h3>
              <button onClick={() => setEditRow(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">법인명 <span className="text-red-500">*</span></label>
                <input
                  autoFocus={!!editRow.isNew}
                  value={editRow.name}
                  onChange={(e) => setEditRow((p) => p ? { ...p, name: e.target.value } : p)}
                  disabled={!editRow.isNew}
                  placeholder="예) 동아쏘시오홀딩스"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">담당자명</label>
                <input
                  value={editRow.contactName || ""}
                  onChange={(e) => setEditRow((p) => p ? { ...p, contactName: e.target.value } : p)}
                  placeholder="예) 홍길동"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">이메일</label>
                <input
                  type="email"
                  value={editRow.email || ""}
                  onChange={(e) => setEditRow((p) => p ? { ...p, email: e.target.value } : p)}
                  placeholder="예) contact@company.com"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">전화번호</label>
                  <input
                    value={editRow.phone || ""}
                    onChange={(e) => setEditRow((p) => p ? { ...p, phone: e.target.value } : p)}
                    placeholder="예) 02-1234-5678"
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">팩스</label>
                  <input
                    value={editRow.fax || ""}
                    onChange={(e) => setEditRow((p) => p ? { ...p, fax: e.target.value } : p)}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">비고</label>
                <input
                  value={editRow.notes || ""}
                  onChange={(e) => setEditRow((p) => p ? { ...p, notes: e.target.value } : p)}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setEditRow(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50">취소</button>
              <button
                onClick={save}
                disabled={saving || !editRow.name.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
              >{saving ? "저장 중..." : "저장"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
