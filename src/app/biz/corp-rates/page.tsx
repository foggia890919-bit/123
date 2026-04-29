"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  Plus, Pencil, Trash2, Search, Loader2, X,
  Upload, Download, ChevronDown,
} from "lucide-react";
import * as XLSX from "xlsx";

interface CorpRate {
  id: string;
  corpName: string;
  companyName: string;
  additionalRate: number;
  memo: string | null;
}

const EMPTY_FORM = {
  corpName: "",
  companyName: "",
  additionalRate: "",
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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

export function CorpRatesContent() {
  const [items, setItems] = useState<CorpRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [corpFilter, setCorpFilter] = useState<string>("__all__");
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<CorpRate | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/corp-rates");
    const data = await res.json();
    setItems(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 법인명 목록 (중복 제거, 정렬)
  const corpNames = Array.from(new Set(items.map((i) => i.corpName))).sort();

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditTarget(null);
    setError(null);
    setModal("add");
  }

  function openEdit(item: CorpRate) {
    setForm({
      corpName: item.corpName,
      companyName: item.companyName,
      additionalRate: String(item.additionalRate),
      memo: item.memo ?? "",
    });
    setEditTarget(item);
    setError(null);
    setModal("edit");
  }

  async function handleSave() {
    setError(null);
    if (!form.corpName.trim() || !form.companyName.trim() || form.additionalRate === "") {
      setError("법인명, 제약사명, 추가수수료율은 필수입니다.");
      return;
    }
    const rateNum = parseFloat(form.additionalRate);
    if (isNaN(rateNum)) {
      setError("추가수수료율은 숫자여야 합니다.");
      return;
    }
    setSaving(true);
    try {
      const method = modal === "edit" ? "PATCH" : "POST";
      const body =
        modal === "edit"
          ? {
              id: editTarget!.id,
              companyName: form.companyName,
              additionalRate: rateNum,
              memo: form.memo || null,
            }
          : {
              corpName: form.corpName,
              companyName: form.companyName,
              additionalRate: rateNum,
              memo: form.memo || null,
            };
      const res = await fetch("/api/corp-rates", {
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

  async function handleDelete(item: CorpRate) {
    if (!confirm(`"${item.corpName} / ${item.companyName}" 수수료 설정을 삭제할까요?`)) return;
    await fetch(`/api/corp-rates?id=${item.id}`, { method: "DELETE" });
    load();
  }

  // 엑셀 다운로드
  function handleDownload() {
    const rows: (string | number | null)[][] = [
      ["법인명", "제약사명", "추가수수료(%)", "메모"],
      ...items.map((i) => [i.corpName, i.companyName, i.additionalRate, i.memo ?? ""]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [16, 20, 14, 24].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "추가수수료");
    XLSX.writeFile(wb, "추가수수료_매핑.xlsx");
  }

  // 엑셀 업로드
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const [, ...dataRows] = raw; // 헤더 제외

      const rows = dataRows
        .filter((r) => String(r[0] ?? "").trim() && String(r[1] ?? "").trim())
        .map((r) => ({
          corpName: String(r[0]).trim(),
          companyName: String(r[1]).trim(),
          additionalRate: parseFloat(String(r[2] ?? "0")) || 0,
          memo: String(r[3] ?? "").trim() || null,
        }));

      if (rows.length === 0) {
        alert("유효한 행이 없어요. A열(법인명)과 B열(제약사명)을 확인해주세요.");
        return;
      }

      let created = 0;
      let failed = 0;
      for (const row of rows) {
        const res = await fetch("/api/corp-rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row),
        });
        if (res.ok) created++;
        else failed++;
      }

      alert(`업로드 완료: ${created}건 등록${failed > 0 ? `, ${failed}건 실패` : ""}`);
      load();
    } finally {
      setUploading(false);
    }
  }

  // 필터링
  const filtered = items.filter((item) => {
    const matchCorp = corpFilter === "__all__" || item.corpName === corpFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      item.corpName.toLowerCase().includes(q) ||
      item.companyName.toLowerCase().includes(q);
    return matchCorp && matchSearch;
  });

  // 법인별 그룹핑
  const grouped = filtered.reduce<Record<string, CorpRate[]>>((acc, item) => {
    if (!acc[item.corpName]) acc[item.corpName] = [];
    acc[item.corpName].push(item);
    return acc;
  }, {});
  const groupKeys = Object.keys(grouped).sort();

  return (
    <>
      <div className="space-y-5">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">추가수수료 매핑</h1>
            <p className="text-sm text-gray-500 mt-0.5">법인별·제약사별 추가수수료율을 관리합니다</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={uploadRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleUpload}
            />
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Download className="w-4 h-4" />
              다운로드
            </button>
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              엑셀 업로드
            </button>
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              항목 추가
            </button>
          </div>
        </div>

        {/* 검색 / 법인 필터 */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="법인명, 제약사명 검색"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="relative">
            <select
              value={corpFilter}
              onChange={(e) => setCorpFilter(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
            >
              <option value="__all__">전체 법인</option>
              {corpNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* 테이블 (법인별 그룹) */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl text-center py-16 text-gray-400 text-sm">
            {search || corpFilter !== "__all__" ? "검색 결과가 없어요." : "등록된 수수료 설정이 없어요."}
          </div>
        ) : (
          <div className="space-y-4">
            {groupKeys.map((corp) => (
              <div key={corp} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-700">{corp}</span>
                  <span className="ml-2 text-xs text-gray-400">{grouped[corp].length}개</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <Th>법인명</Th>
                        <Th>제약사명</Th>
                        <Th>추가수수료(%)</Th>
                        <Th>메모</Th>
                        <Th>관리</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {grouped[corp].map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-700">{item.corpName}</td>
                          <td className="px-4 py-3 font-medium text-gray-900">{item.companyName}</td>
                          <td className="px-4 py-3 text-gray-700 font-mono">
                            {item.additionalRate.toFixed(2)}%
                          </td>
                          <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">
                            {item.memo || "-"}
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
              </div>
            ))}
          </div>
        )}

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
                {modal === "add" ? "수수료 추가" : "수수료 수정"}
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

              <Field label="법인명 *">
                <input
                  value={form.corpName}
                  onChange={(e) => setForm((f) => ({ ...f, corpName: e.target.value }))}
                  disabled={modal === "edit"}
                  placeholder="법인명 입력"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </Field>

              <Field label="제약사명 *">
                <input
                  value={form.companyName}
                  onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                  placeholder="제약사명 입력"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </Field>

              <Field label="추가수수료율(%) *">
                <input
                  type="number"
                  step="0.01"
                  value={form.additionalRate}
                  onChange={(e) => setForm((f) => ({ ...f, additionalRate: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </Field>

              <Field label="메모">
                <input
                  value={form.memo}
                  onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                  placeholder="메모 (선택)"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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

export default function CorpRatesPage() {
  return (
    <BizLayout>
      <CorpRatesContent />
    </BizLayout>
  );
}
