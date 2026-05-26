"use client";

import { useState, useEffect } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BoardRow, EditorRow, UserOption, BOARD_TYPE_LABELS } from "./types";

export default function BoardsTab() {
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Partial<BoardRow>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorsBoard, setEditorsBoard] = useState<BoardRow | null>(null);
  const [editors, setEditors] = useState<EditorRow[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userResults, setUserResults] = useState<UserOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/admin/boards").then(r => r.json()).catch(() => []);
    setBoards(Array.isArray(r) ? r : []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function loadEditors(b: BoardRow) {
    setEditorsBoard(b);
    const r = await fetch(`/api/admin/boards/${b.id}/editors`).then(r => r.json()).catch(() => []);
    setEditors(Array.isArray(r) ? r : []);
  }

  async function searchUsers(q: string) {
    if (!q.trim()) { setUserResults([]); return; }
    setSearchLoading(true);
    const r = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}&limit=10`).then(r => r.json()).catch(() => ({}));
    setUserResults(Array.isArray(r.users) ? r.users : []);
    setSearchLoading(false);
  }
  useEffect(() => {
    const t = setTimeout(() => searchUsers(userSearch), 300);
    return () => clearTimeout(t);
  }, [userSearch]);

  async function addEditor(userId: string) {
    if (!editorsBoard) return;
    await fetch(`/api/admin/boards/${editorsBoard.id}/editors`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }),
    });
    loadEditors(editorsBoard);
    load();
    setUserSearch(""); setUserResults([]);
  }
  async function removeEditor(userId: string) {
    if (!editorsBoard) return;
    await fetch(`/api/admin/boards/${editorsBoard.id}/editors/${userId}`, { method: "DELETE" });
    loadEditors(editorsBoard);
    load();
  }

  function startNew() {
    setForm({ active: true, order: boards.length, type: "MIXED" });
    setEditing("new");
  }
  function startEdit(b: BoardRow) { setForm({ ...b }); setEditing(b.id); }
  function cancelEdit() { setEditing(null); setForm({}); }

  async function save() {
    setSaving(true);
    const payload = { name: form.name, slug: form.slug, description: form.description,
      type: form.type || "MIXED", order: form.order ?? 0, active: form.active !== false };
    if (editing === "new") {
      await fetch("/api/admin/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      await fetch(`/api/admin/boards/${editing}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    setSaving(false); cancelEdit(); load();
  }

  async function remove(id: string) {
    if (!confirm("게시판을 삭제하면 모든 글도 삭제됩니다. 계속할까요?")) return;
    await fetch(`/api/admin/boards/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900">게시판 관리</h2>
          <Button size="sm" onClick={startNew}><Plus className="w-4 h-4 mr-1" />게시판 추가</Button>
        </div>

        {editing && (
          <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-blue-900">{editing === "new" ? "새 게시판" : "게시판 수정"}</h3>
            <div className="flex gap-2">
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="게시판 이름 *" value={form.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="슬러그 (URL용, 영문·숫자·-) *" value={form.slug ?? ""} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
            </div>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="설명 (선택)" value={form.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <div className="flex gap-2 items-center">
              <span className="text-xs text-gray-500">타입:</span>
              {(["TEXT", "IMAGE", "MIXED"] as const).map(t => (
                <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                  className={`px-3 py-1 rounded-full text-xs border ${form.type === t ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600"}`}>
                  {BOARD_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <input type="number" className="w-20 border rounded-lg px-3 py-2 text-sm" placeholder="순서" value={form.order ?? 0} onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))} />
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={form.active !== false} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                활성화
              </label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving || !form.name?.trim() || !form.slug?.trim()}>{saving ? "저장 중…" : "저장"}</Button>
              <Button size="sm" variant="outline" onClick={cancelEdit}>취소</Button>
            </div>
          </div>
        )}

        {/* Editor management panel */}
        {editorsBoard && (
          <div className="mb-5 p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">"{editorsBoard.name}" 편집자 관리</h3>
              <button onClick={() => setEditorsBoard(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex gap-2">
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="이름·이메일로 회원 검색" value={userSearch} onChange={e => setUserSearch(e.target.value)} />
              {searchLoading && <span className="text-xs text-gray-400 self-center">검색 중…</span>}
            </div>
            {userResults.length > 0 && (
              <div className="border rounded-lg divide-y bg-white">
                {userResults.map(u => (
                  <div key={u.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 text-sm">{u.name || "이름없음"} <span className="text-gray-400 text-xs">{u.email}</span></div>
                    <button onClick={() => addEditor(u.id)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">편집자 추가</button>
                  </div>
                ))}
              </div>
            )}
            {editors.length === 0 ? (
              <div className="text-sm text-gray-400">등록된 편집자가 없어요. ADMIN은 모든 게시판에 글을 쓸 수 있습니다.</div>
            ) : (
              <div className="space-y-1">
                {editors.map(e => (
                  <div key={e.id} className="flex items-center gap-2 px-3 py-2 bg-white border rounded-lg">
                    <div className="flex-1 text-sm">{e.user.name || "이름없음"} <span className="text-gray-400 text-xs">{e.user.email}</span></div>
                    <button onClick={() => removeEditor(e.userId)} className="text-xs text-red-400 hover:text-red-600">제거</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loading ? <div className="text-sm text-gray-400">불러오는 중…</div> : boards.length === 0 ? (
          <div className="text-sm text-gray-400 py-6 text-center">등록된 게시판이 없어요.</div>
        ) : (
          <div className="space-y-2">
            {boards.map((b) => (
              <div key={b.id} className={`flex items-center gap-3 p-3 rounded-xl border ${b.active ? "border-gray-200" : "border-dashed border-gray-200 opacity-60"}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{b.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{BOARD_TYPE_LABELS[b.type]}</span>
                    <span className="text-[10px] text-gray-400">/boards/{b.slug}</span>
                  </div>
                  <div className="text-xs text-gray-400">글 {b._count.posts}개 · 편집자 {b._count.editors}명</div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${b.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{b.active ? "활성" : "비활성"}</span>
                <button onClick={() => loadEditors(b)} className="text-xs text-gray-400 hover:text-blue-600">편집자</button>
                <button onClick={() => startEdit(b)} className="text-xs text-gray-400 hover:text-blue-600">수정</button>
                <button onClick={() => remove(b.id)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
