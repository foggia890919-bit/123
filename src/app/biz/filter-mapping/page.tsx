"use client";

import { useState, useEffect, useCallback } from "react";
import { BizLayout } from "@/app/biz/page";
import { Plus, Pencil, Trash2, Search, ToggleLeft, ToggleRight, Loader2, X } from "lucide-react";

interface FilterMapping {
  id: string;
  clientName: string;
  companyName: string;
  submissionEntity: string;
  managerName: string | null;
  managerPhone: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
}

const EMPTY_FORM = {
  clientName: "",
  companyName: "",
  submissionEntity: "",
  managerName: "",
  managerPhone: "",
  notes: "",
};

export default function FilterMappingPage() {
  const [mappings, setMappings] = useState<FilterMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<FilterMapping | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (!showInactive) params.set("active", "true");
    const res = await fetch(`/api/filter-mapping?${params}`);
    const data = await res.json();
    setMappings(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditTarget(null);
    setError(null);
    setModal("add");
  }

  function openEdit(m: FilterMapping) {
    setForm({
      clientName: m.clientName,
      companyName: m.companyName,
      submissionEntity: m.submissionEntity,
      managerName: m.managerName ?? "",
      managerPhone: m.managerPhone ?? "",
      notes: m.notes ?? "",
    });
    setEditTarget(m);
    setError(null);
    setModal("edit");
  }

  async function handleSave() {
    setError(null);
    if (!form.clientName || !form.companyName || !form.submissionEntity) {
      setError("거래처명, 제약사명, 제출처는 필수입니다.");
      return;
    }
    setSaving(true);
    try {
      const method = modal === "edit" ? "PATCH" : "POST";
      const body = modal === "edit"
        ? { id: editTarget!.id, ...form }
        : form;
      const res = await fetch("/api/filter-mapping", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "저장 실패"); return; }
      setModal(null);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(m: FilterMapping) {
    await fetch("/api/filter-mapping", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: m.id, active: !m.active }),
    });
    load();
  }

  async function handleDelete(m: FilterMapping) {
    if (!confirm(`"${m.clientName} × ${m.companyName}" 매핑을 삭제할까요?`)) return;
    await fetch(`/api/filter-mapping?id=${m.id}`, { method: "DELETE" });
    load();
  }

  const filtered = mappings.filter((m) => {
    const q = search.toLowerCase();
    return !q || m.clientName.toLowerCase().includes(q) || m.companyName.toLowerCase().includes(q) || m.submissionEntity.toLowerCase().includes(q);
  });

  return (
    <BizLayout>
      <div className="space-y-5">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">필터링 매핑 관리</h1>
            <p className="text-sm text-gray-500 mt-0.5">거래처 × 제약사별 제출처 및 담당자 설정</p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            매핑 추가
          </button>
        </div>

        {/* 검색 + 필터 */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="거래처명, 제약사명, 제출처 검색"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => setShowInactive(!showInactive)}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            {showInactive
              ? <ToggleRight className="w-5 h-5 text-blue-600" />
              : <ToggleLeft className="w-5 h-5 text-gray-400" />}
            비활성 포함
          </button>
        </div>

        {/* 테이블 */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              {search ? "검색 결과가 없어요." : "등록된 매핑이 없어요."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <Th>거래처명</Th>
                    <Th>제약사명</Th>
                    <Th>제출처</Th>
                    <Th>담당자</Th>
                    <Th>연락처</Th>
                    <Th>상태</Th>
                    <Th>관리</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((m) => (
                    <tr key={m.id} className={`hover:bg-gray-50 transition-colors ${!m.active ? "opacity-50" : ""}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">{m.clientName}</td>
                      <td className="px-4 py-3 text-gray-700">{m.companyName}</td>
                      <td className="px-4 py-3 text-gray-700">{m.submissionEntity}</td>
                      <td className="px-4 py-3 text-gray-600">{m.managerName || "-"}</td>
                      <td className="px-4 py-3 text-gray-600">{m.managerPhone || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${m.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {m.active ? "활성" : "비활성"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => openEdit(m)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="수정"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(m)}
                            className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                            title={m.active ? "비활성화" : "활성화"}
                          >
                            {m.active ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleDelete(m)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 요약 */}
        {!loading && (
          <p className="text-xs text-gray-400 text-right">
            총 {filtered.length}개 매핑
          </p>
        )}
      </div>

      {/* 모달 */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">
                {modal === "add" ? "매핑 추가" : "매핑 수정"}
              </h2>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              <div className="grid grid-cols-2 gap-3">
                <Field label="거래처명 *">
                  <input
                    value={form.clientName}
                    onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                    disabled={modal === "edit"}
                    placeholder="예: 연세내과"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </Field>
                <Field label="제약사명 *">
                  <input
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                    disabled={modal === "edit"}
                    placeholder="예: 동아제약"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </Field>
              </div>

              <Field label="제출처 *">
                <input
                  value={form.submissionEntity}
                  onChange={(e) => setForm({ ...form, submissionEntity: e.target.value })}
                  placeholder="예: 동아제약 서울지점"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="담당자명">
                  <input
                    value={form.managerName}
                    onChange={(e) => setForm({ ...form, managerName: e.target.value })}
                    placeholder="홍길동"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </Field>
                <Field label="담당자 연락처">
                  <input
                    value={form.managerPhone}
                    onChange={(e) => setForm({ ...form, managerPhone: e.target.value })}
                    placeholder="010-0000-0000"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </Field>
              </div>

              <Field label="메모">
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder="기타 참고사항"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </Field>
            </div>
            <div className="px-6 pb-5 flex gap-2 justify-end">
              <button
                onClick={() => setModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </BizLayout>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
      {children}
    </th>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}
