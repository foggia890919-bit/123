"use client";

import { useState, useEffect } from "react";
import { CheckCircle, RefreshCw, Search, X, Loader2 } from "lucide-react";
import { CompanySubmission, emptySubmission } from "./types";

export default function CompanySubmissionsTab() {
  const [subTab, setSubTab] = useState<"new" | "bulk" | "current">("current");
  const [rows, setRows] = useState<CompanySubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [inlineEdits, setInlineEdits] = useState<Map<string, Record<string, string>>>(new Map());
  const [inlineSavingName, setInlineSavingName] = useState<string | null>(null);
  const [inlineSavedSet, setInlineSavedSet] = useState<Set<string>>(new Set());
  // 신규 등록 폼
  const [newForm, setNewForm] = useState<CompanySubmission>({ ...emptySubmission() });
  const [savingNew, setSavingNew] = useState(false);
  const [newSaved, setNewSaved] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/company-submissions");
    const data = await res.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function saveNew() {
    const name = newForm.companyName.trim();
    if (!name) { alert("제약사명은 필수에요."); return; }
    setSavingNew(true);
    const res = await fetch("/api/admin/company-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newForm),
    });
    if (res.ok) {
      const saved: CompanySubmission = await res.json();
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.companyName === saved.companyName);
        return idx >= 0 ? prev.map((r, i) => i === idx ? saved : r) : [...prev, saved].sort((a, b) => a.companyName.localeCompare(b.companyName));
      });
      setNewForm({ ...emptySubmission() });
      setNewSaved(true);
      setTimeout(() => setNewSaved(false), 2000);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(`저장 실패: ${data.error || "알 수 없는 오류"}`);
    }
    setSavingNew(false);
  }

  function getInlineField(companyName: string, field: keyof CompanySubmission): string {
    const edits = inlineEdits.get(companyName);
    if (edits && field in edits) return edits[field as string];
    const row = rows.find((r) => r.companyName === companyName);
    if (!row) return "";
    const v = row[field];
    return v != null ? String(v) : "";
  }

  function updateInlineField(companyName: string, field: keyof CompanySubmission, value: string) {
    setInlineEdits((prev) => {
      const n = new Map(prev);
      n.set(companyName, { ...(n.get(companyName) ?? {}), [field]: value });
      return n;
    });
    setInlineSavedSet((prev) => { const n = new Set(prev); n.delete(companyName); return n; });
  }

  async function saveInlineRow(companyName: string) {
    if (inlineSavingName === companyName) return;
    const baseRow = rows.find((r) => r.companyName === companyName);
    if (!baseRow) return;
    const edits = inlineEdits.get(companyName) ?? {};
    const merged: CompanySubmission = {
      ...baseRow,
      submissionEntity: "submissionEntity" in edits ? edits.submissionEntity || null : baseRow.submissionEntity,
      contactName: "contactName" in edits ? edits.contactName || null : baseRow.contactName,
      email: "email" in edits ? edits.email || null : baseRow.email,
      phone: "phone" in edits ? edits.phone || null : baseRow.phone,
      fax: "fax" in edits ? edits.fax || null : baseRow.fax,
      defaultAdditionalRate: "defaultAdditionalRate" in edits
        ? (edits.defaultAdditionalRate !== "" ? Number(edits.defaultAdditionalRate) : null)
        : baseRow.defaultAdditionalRate,
      notes: "notes" in edits ? edits.notes || null : baseRow.notes,
    };
    setInlineSavingName(companyName);
    try {
      const res = await fetch("/api/admin/company-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      });
      if (res.ok) {
        const saved: CompanySubmission = await res.json();
        setRows((prev) => prev.map((r) => r.companyName === saved.companyName ? saved : r));
        setInlineEdits((prev) => { const n = new Map(prev); n.delete(companyName); return n; });
        setInlineSavedSet((prev) => new Set([...prev, companyName]));
      }
    } finally {
      setInlineSavingName(null);
    }
  }

  async function deleteRow(companyName: string) {
    if (!confirm(`"${companyName}" 제출처 정보를 삭제할까요?`)) return;
    setDeletingName(companyName);
    await fetch("/api/admin/company-submissions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName }),
    });
    setRows((prev) => prev.filter((r) => r.companyName !== companyName));
    setDeletingName(null);
  }

  const filtered = rows.filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return r.companyName.toLowerCase().includes(q) ||
      (r.contactName || "").toLowerCase().includes(q) ||
      (r.email || "").toLowerCase().includes(q) ||
      (r.phone || "").includes(query);
  });

  const fieldCls = "w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* 서브탭 헤더 */}
        <div className="px-5 pt-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1">
            {([["new","신규 등록"],["bulk","일괄 업로드"],["current","현재 현황"]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSubTab(key)}
                className={`text-sm px-4 py-2 border-b-2 font-medium transition-colors ${subTab === key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"}`}
              >{label}{key === "current" && <span className="ml-1 text-xs opacity-60">({rows.length})</span>}</button>
            ))}
          </div>
          {subTab === "current" && (
            <div className="flex items-center gap-2 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제약사·담당자·이메일·전화번호"
                  className="h-8 w-60 border border-gray-200 rounded pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                {query && <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>}
              </div>
              <button onClick={load} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />새로고침
              </button>
            </div>
          )}
        </div>

        {/* 신규 등록 */}
        {subTab === "new" && (
          <div className="p-6 max-w-lg">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">제약사명 <span className="text-red-500">*</span></label>
                <input value={newForm.companyName} onChange={(e) => setNewForm((p) => ({ ...p, companyName: e.target.value }))} placeholder="예) 동아ST" className={fieldCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">제출처 법인명</label>
                <input value={newForm.submissionEntity || ""} onChange={(e) => setNewForm((p) => ({ ...p, submissionEntity: e.target.value }))} placeholder="예) 동아쏘시오홀딩스" className={fieldCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">담당자명</label>
                  <input value={newForm.contactName || ""} onChange={(e) => setNewForm((p) => ({ ...p, contactName: e.target.value }))} placeholder="예) 홍길동" className={fieldCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">기본 추가수수료 (%)</label>
                  <input type="number" step="0.1" min="0" value={newForm.defaultAdditionalRate ?? ""} onChange={(e) => setNewForm((p) => ({ ...p, defaultAdditionalRate: e.target.value !== "" ? Number(e.target.value) : null }))} placeholder="예) 2.5" className={fieldCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">이메일</label>
                <input type="email" value={newForm.email || ""} onChange={(e) => setNewForm((p) => ({ ...p, email: e.target.value }))} placeholder="예) contact@company.com" className={fieldCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">전화번호</label>
                  <input value={newForm.phone || ""} onChange={(e) => setNewForm((p) => ({ ...p, phone: e.target.value }))} placeholder="예) 02-1234-5678" className={fieldCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">팩스</label>
                  <input value={newForm.fax || ""} onChange={(e) => setNewForm((p) => ({ ...p, fax: e.target.value }))} className={fieldCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">비고</label>
                <textarea value={newForm.notes || ""} onChange={(e) => setNewForm((p) => ({ ...p, notes: e.target.value }))} rows={2} className={`${fieldCls} resize-none`} />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button onClick={saveNew} disabled={savingNew || !newForm.companyName.trim()}
                  className="px-5 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 font-medium">
                  {savingNew ? "저장 중..." : "저장"}
                </button>
                {newSaved && <span className="text-sm text-emerald-600 flex items-center gap-1"><CheckCircle className="w-4 h-4" />저장됐어요!</span>}
                <button onClick={() => setNewForm({ ...emptySubmission() })} className="text-xs text-gray-400 hover:text-gray-600">초기화</button>
              </div>
            </div>
          </div>
        )}

        {/* 일괄 업로드 */}
        {subTab === "bulk" && <SubmissionUploadTab onSaved={load} />}

        {/* 현재 현황 */}
        {subTab === "current" && (
          loading ? (
            <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-xs min-w-[1100px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                    <th className="px-3 py-2 text-left w-36">제약사명</th>
                    <th className="px-1 py-2 text-left">제출처 법인명</th>
                    <th className="px-1 py-2 text-left w-28">담당자명</th>
                    <th className="px-1 py-2 text-right w-20">추가수수료</th>
                    <th className="px-1 py-2 text-left">이메일</th>
                    <th className="px-1 py-2 text-left w-32">전화번호</th>
                    <th className="px-1 py-2 text-left w-28">팩스</th>
                    <th className="px-1 py-2 text-left">비고</th>
                    <th className="px-2 py-2 text-center w-14">상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((row) => {
                    const isSaving = inlineSavingName === row.companyName;
                    const isSaved = inlineSavedSet.has(row.companyName);
                    const hasEdits = inlineEdits.has(row.companyName);
                    const inCls = "w-full h-7 px-2 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white";
                    return (
                      <tr
                        key={row.companyName}
                        className={isSaved ? "bg-emerald-50/40" : hasEdits ? "bg-amber-50/30" : "hover:bg-gray-50"}
                        onBlur={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !isSaving) {
                            saveInlineRow(row.companyName);
                          }
                        }}
                      >
                        <td className="px-3 py-1.5 font-medium text-gray-900 text-xs whitespace-nowrap">{row.companyName}</td>
                        <td className="px-1 py-1"><input value={getInlineField(row.companyName, "submissionEntity")} onChange={(e) => updateInlineField(row.companyName, "submissionEntity", e.target.value)} className={inCls} /></td>
                        <td className="px-1 py-1"><input value={getInlineField(row.companyName, "contactName")} onChange={(e) => updateInlineField(row.companyName, "contactName", e.target.value)} className={inCls} /></td>
                        <td className="px-1 py-1"><input type="number" step="0.1" min="0" value={getInlineField(row.companyName, "defaultAdditionalRate")} onChange={(e) => updateInlineField(row.companyName, "defaultAdditionalRate", e.target.value)} className={`${inCls} text-right`} placeholder="0" /></td>
                        <td className="px-1 py-1"><input type="email" value={getInlineField(row.companyName, "email")} onChange={(e) => updateInlineField(row.companyName, "email", e.target.value)} className={inCls} /></td>
                        <td className="px-1 py-1"><input value={getInlineField(row.companyName, "phone")} onChange={(e) => updateInlineField(row.companyName, "phone", e.target.value)} className={inCls} /></td>
                        <td className="px-1 py-1"><input value={getInlineField(row.companyName, "fax")} onChange={(e) => updateInlineField(row.companyName, "fax", e.target.value)} className={inCls} /></td>
                        <td className="px-1 py-1"><input value={getInlineField(row.companyName, "notes")} onChange={(e) => updateInlineField(row.companyName, "notes", e.target.value)} className={inCls} /></td>
                        <td className="px-2 py-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                            {isSaved && !isSaving && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                            <button onClick={() => deleteRow(row.companyName)} disabled={deletingName === row.companyName}
                              className="text-gray-300 hover:text-red-500 disabled:opacity-40" title="삭제">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className="py-12 text-center text-gray-400 text-sm">
                      {query ? "검색 결과가 없어요." : "등록된 제출처 정보가 없어요."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
