"use client";

import { useState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner, BG_PRESETS } from "./types";

export default function BannersTab() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Partial<Banner> & { imageDataUri?: string }>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/admin/banners").then(r => r.json()).catch(() => []);
    setBanners(Array.isArray(r) ? r : []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function startNew() {
    setForm({ active: true, order: banners.length, bgColor: BG_PRESETS[0].value });
    setEditing("new");
  }
  function startEdit(b: Banner) {
    setForm({ ...b });
    setEditing(b.id);
  }
  function cancelEdit() { setEditing(null); setForm({}); }

  function pickImage() { fileRef.current?.click(); }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm(f => ({ ...f, imageDataUri: reader.result as string }));
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function save() {
    setSaving(true);
    let imageKey = form.imageKey ?? null;
    if (form.imageDataUri) {
      const up = await fetch("/api/upload/banner-image", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUri: form.imageDataUri }),
      }).then(r => r.json()).catch(() => ({}));
      if (up.key) imageKey = up.key;
    }
    const payload = { title: form.title, subtitle: form.subtitle, description: form.description,
      buttonText: form.buttonText, buttonLink: form.buttonLink, imageKey, bgColor: form.bgColor,
      order: form.order ?? 0, active: form.active !== false };

    if (editing === "new") {
      await fetch("/api/admin/banners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      await fetch(`/api/admin/banners/${editing}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    setSaving(false);
    cancelEdit();
    load();
  }

  async function toggleActive(b: Banner) {
    await fetch(`/api/admin/banners/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !b.active }) });
    load();
  }
  async function remove(id: string) {
    if (!confirm("배너를 삭제할까요?")) return;
    await fetch(`/api/admin/banners/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900">메인 배너 관리</h2>
          <Button size="sm" onClick={startNew}><Plus className="w-4 h-4 mr-1" />배너 추가</Button>
        </div>

        {editing && (
          <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-blue-900">{editing === "new" ? "새 배너" : "배너 수정"}</h3>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="제목 *" value={form.title ?? ""} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="부제목" value={form.subtitle ?? ""} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} />
            <textarea className="w-full border rounded-lg px-3 py-2 text-sm resize-none" rows={2} placeholder="설명 텍스트" value={form.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <div className="flex gap-2">
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="버튼 텍스트" value={form.buttonText ?? ""} onChange={e => setForm(f => ({ ...f, buttonText: e.target.value }))} />
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="버튼 링크 (예: /search)" value={form.buttonLink ?? ""} onChange={e => setForm(f => ({ ...f, buttonLink: e.target.value }))} />
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-xs text-gray-500 mr-1">배경색:</span>
              {BG_PRESETS.map(p => (
                <button key={p.value} onClick={() => setForm(f => ({ ...f, bgColor: p.value }))}
                  className={`px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r ${p.value} text-white border-2 ${form.bgColor === p.value ? "border-blue-600" : "border-transparent"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <button onClick={pickImage} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">이미지 선택</button>
              {(form.imageDataUri || form.imageUrl) && <span className="text-xs text-green-600">✓ 이미지 선택됨</span>}
              {(form.imageDataUri || form.imageUrl) && <button onClick={() => setForm(f => ({ ...f, imageDataUri: undefined, imageKey: null, imageUrl: null }))} className="text-xs text-red-400 hover:text-red-600">제거</button>}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
            </div>
            <div className="flex gap-2 items-center">
              <input type="number" className="w-20 border rounded-lg px-3 py-2 text-sm" placeholder="순서" value={form.order ?? 0} onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))} />
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={form.active !== false} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                활성화
              </label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving || !form.title?.trim()}>{saving ? "저장 중…" : "저장"}</Button>
              <Button size="sm" variant="outline" onClick={cancelEdit}>취소</Button>
            </div>
          </div>
        )}

        {loading ? <div className="text-sm text-gray-400">불러오는 중…</div> : banners.length === 0 ? (
          <div className="text-sm text-gray-400 py-6 text-center">등록된 배너가 없어요.</div>
        ) : (
          <div className="space-y-2">
            {banners.map((b) => (
              <div key={b.id} className={`flex items-center gap-3 p-3 rounded-xl border ${b.active ? "border-gray-200" : "border-dashed border-gray-200 opacity-60"}`}>
                <div className={`w-14 h-10 rounded-lg bg-gradient-to-r ${b.bgColor || "from-blue-900 to-blue-700"} flex-shrink-0 overflow-hidden`}>
                  {b.imageUrl && <img src={b.imageUrl} alt="" className="w-full h-full object-cover opacity-60" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{b.title}</div>
                  <div className="text-xs text-gray-400 truncate">{b.subtitle}</div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${b.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{b.active ? "활성" : "비활성"}</span>
                <button onClick={() => toggleActive(b)} className="text-xs text-gray-400 hover:text-blue-600">{b.active ? "끄기" : "켜기"}</button>
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
