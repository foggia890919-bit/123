"use client";

import { useState, useEffect, useCallback } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  Plus, Pencil, Trash2, Search, Loader2, X,
  ToggleLeft, ToggleRight,
} from "lucide-react";

interface CoPromotion {
  id: string;
  productName: string;
  statCompany: string;
  billingCompany: string;
  memo: string | null;
  active: boolean;
}

const EMPTY_FORM = {
  productName: "",
  statCompany: "",
  billingCompany: "",
  memo: "",
};

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
      {children}
    </th>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-[11px] text-gray-400 mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

export function CoPromotionContent() {
  const [items, setItems] = useState<CoPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<CoPromotion | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (!showInactive) params.set("active", "true");
    const res = await fetch(`/api/co-promotion?${params}`);
    const data = await res.json();
    setItems(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditTarget(null);
    setError(null);
    setModal("add");
  }

  function openEdit(item: CoPromotion) {
    setForm({
      productName: item.productName,
      statCompany: item.statCompany,
      billingCompany: item.billingCompany,
      memo: item.memo ?? "",
    });
    setEditTarget(item);
    setError(null);
    setModal("edit");
  }

  async function handleSave() {
    setError(null);
    if (!form.productName.trim() || !form.statCompany.trim() || !form.billingCompany.trim()) {
      setError("품목명, 병원통계 제약사, 실제 정산 제약사는 필수입니다.");
      return;
    }
    setSaving(true);
    try {
      const method = modal === "edit" ? "PATCH" : "POST";
      const body =
        modal === "edit"
          ? {
              id: editTarget!.id,
              statCompany: form.statCompany,
              billingCompany: form.billingCompany,
              memo: form.memo || null,
            }
          : {
              productName: form.productName,
              statCompany: form.statCompany,
              billingCompany: form.billingCompany,
              memo: form.memo || null,
            };
      const res = await fetch("/api/co-promotion", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "저장 실패");
        return;
      }
      setModal(null);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(item: CoPromotion) {
    await fetch("/api/co-promotion", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, active: !item.active }),
    });
    load();
  }

  async function handleDelete(item: CoPromotion) {
    if (!confirm(`"${item.productName}" 코프로모션 매핑을 삭제할까요?`)) return;
    await fetch(`/api/co-promotion?id=${item.id}`, { method: "DELETE" });
    load();
  }

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    return (
      !q ||
      item.productName.toLowerCase().includes(q) ||
      item.statCompany.toLowerCase().includes(q) ||
      item.billingCompany.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <div className="space-y-5">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">코프로모션 예외 관리</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              병원통계 제약사와 실제 정산 제약사가 다른 품목을 등록합니다
              <span className="ml-1 text-gray-400">(예: 다산제약 오마코 → 제일약품 정산)</span>
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            항목 추가
          </button>
        </div>

        {/* 검색 / 필터 */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="품목명, 제약사명 검색"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => setShowInactive(!showInactive)}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            {showInactive ? (
              <ToggleRight className="w-5 h-5 text-blue-600" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-gray-400" />
            )}
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
              {search ? "검색 결과가 없어요." : "등록된 코프로모션 매핑이 없어요."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <Th>품목명</Th>
                    <Th>통계제약사</Th>
                    <Th>정산제약사</Th>
                    <Th>메모</Th>
                    <Th>상태</Th>
                    <Th>관리</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className={`hover:bg-gray-50 transition-colors ${!item.active ? "opacity-50" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{item.productName}</td>
                      <td className="px-4 py-3 text-gray-700">{item.statCompany}</td>
                      <td className="px-4 py-3 text-gray-700">{item.billingCompany}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">
                        {item.memo || "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            item.active
                              ? "bg-green-50 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {item.active ? "활성" : "비활성"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => openEdit(item)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="수정"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(item)}
                            className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                            title={item.active ? "비활성화" : "활성화"}
                          >
                            {item.active ? (
                              <ToggleRight className="w-3.5 h-3.5" />
                            ) : (
                              <ToggleLeft className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
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

        {!loading && (
          <p className="text-xs text-gray-400 text-right">총 {filtered.length}개 항목</p>
        )}
      </div>

      {/* 모달 */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">
                {modal === "add" ? "코프로모션 추가" : "코프로모션 수정"}
              </h2>
              <button
                onClick={() => setModal(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <Field label="품목명 *">
                <input
                  value={form.productName}
                  onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))}
                  disabled={modal === "edit"}
                  placeholder="예: 오마코연질캡슐"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </Field>

              <Field
                label="병원통계 제약사 *"
                hint="병원통계/처방전에 표기되는 제약사명"
              >
                <input
                  value={form.statCompany}
                  onChange={(e) => setForm((f) => ({ ...f, statCompany: e.target.value }))}
                  placeholder="예: 다산제약"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </Field>

              <Field
                label="실제 정산 제약사 *"
                hint="코프로모션으로 실제 정산하는 제약사명"
              >
                <input
                  value={form.billingCompany}
                  onChange={(e) => setForm((f) => ({ ...f, billingCompany: e.target.value }))}
                  placeholder="예: 제일약품"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </Field>

              <Field label="메모">
                <textarea
                  value={form.memo}
                  onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                  placeholder="메모 (선택)"
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </Field>
            </div>

            <div className="flex justify-end gap-2 px-6 pb-5">
              <button
                onClick={() => setModal(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {modal === "add" ? "추가" : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function CoPromotionPage() {
  return (
    <BizLayout>
      <CoPromotionContent />
    </BizLayout>
  );
}
