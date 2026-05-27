"use client";

import { useState, useEffect, useRef } from "react";
import { Upload, CheckCircle, AlertCircle, Download, Plus, RefreshCw, Search, X } from "lucide-react";
import * as XLSX from "xlsx";
import { CompanySubmission, SubUploadRow, EXPECTED_COLUMNS, validateRow } from "./types";

export default function SubmissionUploadTab({ onSaved }: { onSaved?: () => void } = {}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SubUploadRow[]>([]);
  const [savedSet, setSavedSet] = useState<Set<number>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewQuery, setPreviewQuery] = useState("");
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Tabs & current-status state
  const [activeTab, setActiveTab] = useState<"upload" | "current">("upload");
  const [currentRows, setCurrentRows] = useState<SubUploadRow[]>([]);
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentQuery, setCurrentQuery] = useState("");
  const [currentSavedSet, setCurrentSavedSet] = useState<Set<string>>(new Set());
  const [currentSavingName, setCurrentSavingName] = useState<string | null>(null);

  useEffect(() => { loadCurrentRows(); }, []);

  async function loadCurrentRows() {
    setCurrentLoading(true);
    try {
      const res = await fetch("/api/admin/company-submissions");
      const data = await res.json();
      if (Array.isArray(data)) {
        setCurrentRows(data.map((r: CompanySubmission) => ({
          companyName: r.companyName || "",
          submissionEntity: r.submissionEntity || "",
          contactName: r.contactName || "",
          email: r.email || "",
          phone: r.phone || "",
          fax: r.fax || "",
          defaultAdditionalRate: r.defaultAdditionalRate != null ? String(r.defaultAdditionalRate) : "",
          notes: r.notes || "",
        })));
      }
    } catch {}
    setCurrentLoading(false);
  }

  function updateCurrentField(companyName: string, field: keyof SubUploadRow, value: string) {
    setCurrentRows((prev) => prev.map((r) => {
      if (r.companyName !== companyName) return r;
      const updated = { ...r, [field]: value } as SubUploadRow;
      updated._error = validateRow(updated);
      return updated;
    }));
    setCurrentSavedSet((prev) => { const n = new Set(prev); n.delete(companyName); return n; });
  }

  async function saveCurrentRow(row: SubUploadRow) {
    if (row._error || !row.companyName) return;
    setCurrentSavingName(row.companyName);
    try {
      const res = await fetch("/api/admin/company-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: row.companyName,
          submissionEntity: row.submissionEntity || null,
          contactName: row.contactName || null,
          email: row.email || null,
          phone: row.phone || null,
          fax: row.fax || null,
          defaultAdditionalRate: row.defaultAdditionalRate !== "" ? Number(row.defaultAdditionalRate) : null,
          notes: row.notes || null,
        }),
      });
      if (res.ok) { setCurrentSavedSet((prev) => new Set([...prev, row.companyName])); onSaved?.(); }
      else { const d = await res.json().catch(() => ({})); alert(`저장 실패: ${d.error || "오류"}`); }
    } finally { setCurrentSavingName(null); }
  }

  async function deleteCurrentRow(companyName: string) {
    if (!confirm(`"${companyName}" 제출처 정보를 삭제할까요?`)) return;
    const res = await fetch("/api/admin/company-submissions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName }),
    });
    if (res.ok) { setCurrentRows((prev) => prev.filter((r) => r.companyName !== companyName)); onSaved?.(); }
    else alert("삭제 실패");
  }

  function parseFile(f: File) {
    setFile(f);
    setResult(null);
    setParseError(null);
    setSavedSet(new Set());
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        if (raw.length === 0) { setParseError("시트에 데이터가 없어요."); return; }

        const rows: SubUploadRow[] = raw.map((r) => {
          const row: SubUploadRow = { companyName: "", submissionEntity: "", contactName: "", email: "", phone: "", fax: "", defaultAdditionalRate: "", notes: "" };
          for (const [colKey, val] of Object.entries(r)) {
            const field = EXPECTED_COLUMNS[colKey.trim()];
            if (field) row[field] = String(val ?? "").trim();
          }
          row._error = validateRow(row);
          return row;
        });

        setPreview(rows);
      } catch {
        setParseError("파일을 읽는 중 오류가 발생했어요. xlsx/xls 파일인지 확인해 주세요.");
      }
    };
    reader.readAsBinaryString(f);
  }

  function updateField(idx: number, field: keyof SubUploadRow, value: string) {
    setPreview((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: value } as SubUploadRow;
      updated._error = validateRow(updated);
      return updated;
    }));
    setSavedSet((prev) => {
      if (!prev.has(idx)) return prev;
      const n = new Set(prev);
      n.delete(idx);
      return n;
    });
  }

  function deleteRow(idx: number) {
    setPreview((prev) => prev.filter((_, i) => i !== idx));
    setSavedSet((prev) => {
      const n = new Set<number>();
      for (const id of prev) {
        if (id < idx) n.add(id);
        else if (id > idx) n.add(id - 1);
      }
      return n;
    });
  }

  function addBlankRow() {
    setPreview((prev) => [...prev, { companyName: "", submissionEntity: "", contactName: "", email: "", phone: "", fax: "", defaultAdditionalRate: "", notes: "", _error: "제약사명 없음" }]);
  }

  async function saveOne(idx: number) {
    const row = preview[idx];
    if (row._error || !row.companyName) return;
    setSavingIdx(idx);
    try {
      const res = await fetch("/api/admin/company-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: row.companyName,
          submissionEntity: row.submissionEntity || null,
          contactName: row.contactName || null,
          email: row.email || null,
          phone: row.phone || null,
          fax: row.fax || null,
          defaultAdditionalRate: row.defaultAdditionalRate !== "" ? Number(row.defaultAdditionalRate) : null,
          notes: row.notes || null,
        }),
      });
      if (res.ok) {
        setSavedSet((prev) => new Set([...prev, idx]));
        onSaved?.();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(`저장 실패: ${data.error || "알 수 없는 오류"}`);
      }
    } finally {
      setSavingIdx(null);
    }
  }

  async function saveAll() {
    const toSave = preview.map((r, i) => ({ r, i })).filter(({ r, i }) => !r._error && r.companyName && !savedSet.has(i));
    if (toSave.length === 0) return;
    setBatchSaving(true);
    setResult(null);
    const payload = toSave.map(({ r }) => ({
      companyName: r.companyName,
      submissionEntity: r.submissionEntity || null,
      contactName: r.contactName || null,
      email: r.email || null,
      phone: r.phone || null,
      fax: r.fax || null,
      defaultAdditionalRate: r.defaultAdditionalRate !== "" ? Number(r.defaultAdditionalRate) : null,
      notes: r.notes || null,
    }));
    const res = await fetch("/api/admin/company-submissions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setResult(data);
    if (res.ok) {
      setSavedSet((prev) => {
        const n = new Set(prev);
        toSave.forEach(({ i }) => n.add(i));
        return n;
      });
      onSaved?.();
    }
    setBatchSaving(false);
  }

  async function downloadTemplate() {
    let templateData: Record<string, string>[];
    try {
      const res = await fetch("/api/admin/company-submissions");
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        templateData = (data as CompanySubmission[]).map((r) => ({
          제약사명: r.companyName || "",
          제출처법인명: r.submissionEntity || "",
          담당자: r.contactName || "",
          이메일: r.email || "",
          전화번호: r.phone || "",
          팩스: r.fax || "",
          추가수수료: r.defaultAdditionalRate != null ? String(r.defaultAdditionalRate) : "",
          비고: r.notes || "",
        }));
      } else {
        templateData = [
          { 제약사명: "동아ST", 제출처법인명: "동아쏘시오홀딩스", 담당자: "홍길동", 이메일: "contact@donga.com", 전화번호: "02-1234-5678", 팩스: "02-1234-5679", 추가수수료: "2.5", 비고: "" },
          { 제약사명: "한미약품", 제출처법인명: "", 담당자: "", 이메일: "", 전화번호: "", 팩스: "", 추가수수료: "", 비고: "" },
        ];
      }
    } catch {
      templateData = [
        { 제약사명: "동아ST", 제출처법인명: "동아쏘시오홀딩스", 담당자: "홍길동", 이메일: "contact@donga.com", 전화번호: "02-1234-5678", 팩스: "02-1234-5679", 추가수수료: "2.5", 비고: "" },
      ];
    }
    const ws = XLSX.utils.json_to_sheet(templateData);
    ws["!cols"] = [{ wch: 16 }, { wch: 18 }, { wch: 10 }, { wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "제출처");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "제출처업로드_양식.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  const errorRows = preview.filter((r) => r._error);
  const validCount = preview.length - errorRows.length;
  const savedCount = savedSet.size;

  const previewFiltered = previewQuery.trim()
    ? preview.map((r, i) => ({ r, i })).filter(({ r }) => {
        const q = previewQuery.toLowerCase();
        return r.companyName.toLowerCase().includes(q) ||
          r.submissionEntity.toLowerCase().includes(q) ||
          r.contactName.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q);
      })
    : preview.map((r, i) => ({ r, i }));

  const currentFiltered = currentQuery.trim()
    ? currentRows.filter((r) => {
        const q = currentQuery.toLowerCase();
        return r.companyName.toLowerCase().includes(q) ||
          (r.submissionEntity || "").toLowerCase().includes(q) ||
          (r.contactName || "").toLowerCase().includes(q) ||
          (r.email || "").toLowerCase().includes(q);
      })
    : currentRows;

  const inputCls = "w-full bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:bg-white rounded px-1.5 py-1 text-xs focus:outline-none transition-colors";

  const tableHead = (
    <thead className="sticky top-0 bg-gray-50 z-10">
      <tr className="text-gray-500 font-semibold">
        <th className="px-2 py-2.5 text-left w-8">#</th>
        <th className="px-2 py-2.5 text-left w-[160px]">제약사명 *</th>
        <th className="px-2 py-2.5 text-left w-[160px]">제출처법인명</th>
        <th className="px-2 py-2.5 text-left w-[100px]">담당자</th>
        <th className="px-2 py-2.5 text-left w-[180px]">이메일</th>
        <th className="px-2 py-2.5 text-left w-[120px]">전화</th>
        <th className="px-2 py-2.5 text-left w-[120px]">팩스</th>
        <th className="px-2 py-2.5 text-right w-[80px]">수수료%</th>
        <th className="px-2 py-2.5 text-left">비고</th>
        <th className="px-2 py-2.5 text-center w-[90px]">저장</th>
        <th className="px-2 py-2.5 text-center w-[40px]"></th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-3">
      {/* Compact header: title + upload button + template download */}
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">제출처 일괄 업로드</h2>
            <p className="text-xs text-gray-400 mt-0.5">엑셀로 업로드한 내용은 미리보기 탭에서 수정·저장할 수 있어요.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={downloadTemplate} className="flex items-center gap-1.5 text-xs text-blue-600 border border-blue-200 hover:bg-blue-50 rounded px-3 py-1.5 transition-colors">
              <Download className="w-3.5 h-3.5" />양식 내려받기
            </button>
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs border border-gray-200 hover:border-blue-300 hover:bg-blue-50 rounded px-3 py-1.5 text-gray-600 hover:text-blue-600 transition-colors">
              <Upload className="w-3.5 h-3.5" />
              {file ? <span className="font-medium text-blue-700 max-w-[140px] truncate">{file.name}</span> : "엑셀 선택 (.xlsx / .xls)"}
              <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { parseFile(f); setActiveTab("upload"); } e.target.value = ""; }} />
            </label>
            {file && (
              <button type="button"
                onClick={() => { setFile(null); setPreview([]); setResult(null); setSavedSet(new Set()); }}
                className="text-xs text-red-400 hover:text-red-600 transition-colors">× 제거</button>
            )}
          </div>
        </div>
        {parseError && <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2">{parseError}</p>}
        {file && !parseError && (
          <p className="mt-1.5 text-xs text-gray-400">{preview.length}행 · 유효 {validCount}{errorRows.length > 0 ? ` · 오류 ${errorRows.length}` : ""} · 저장됨 {savedCount}</p>
        )}
      </div>

      {/* Tabbed area */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Tab bar */}
        <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-0.5">
            <button type="button" onClick={() => setActiveTab("upload")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === "upload" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
              업로드 미리보기 <span className={activeTab === "upload" ? "opacity-70" : "text-gray-400"}>({preview.length}행)</span>
            </button>
            <button type="button" onClick={() => { setActiveTab("current"); loadCurrentRows(); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === "current" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
              현재 현황 <span className={activeTab === "current" ? "opacity-70" : "text-gray-400"}>({currentRows.length}개)</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                value={activeTab === "upload" ? previewQuery : currentQuery}
                onChange={(e) => activeTab === "upload" ? setPreviewQuery(e.target.value) : setCurrentQuery(e.target.value)}
                placeholder="검색"
                className="h-8 w-44 border border-gray-200 rounded pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            {activeTab === "upload" ? (
              <>
                <button onClick={addBlankRow}
                  className="text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 rounded px-2 py-1.5 flex items-center gap-1">
                  <Plus className="w-3 h-3" />행 추가
                </button>
                <button onClick={saveAll} disabled={batchSaving || validCount === 0 || validCount === savedCount}
                  className="h-8 px-3 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 flex items-center gap-1.5">
                  {batchSaving ? <><RefreshCw className="w-3 h-3 animate-spin" />업로드 중...</> : <><Upload className="w-3 h-3" />{Math.max(0, validCount - savedCount)}행 일괄 저장</>}
                </button>
              </>
            ) : (
              <button onClick={loadCurrentRows} disabled={currentLoading}
                className="text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 rounded px-2 py-1.5 flex items-center gap-1 disabled:opacity-50">
                <RefreshCw className={`w-3 h-3 ${currentLoading ? "animate-spin" : ""}`} />새로고침
              </button>
            )}
          </div>
        </div>

        {/* Upload preview tab */}
        {activeTab === "upload" && (
          preview.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">
              위에서 엑셀을 선택하면 이 곳에 표시됩니다. 행마다 바로 수정하고 저장할 수 있어요.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-xs min-w-[1180px]">
                {tableHead}
                <tbody className="divide-y divide-gray-100">
                  {previewFiltered.map(({ r: row, i }) => {
                    const isSaved = savedSet.has(i);
                    const hasError = !!row._error;
                    const isSaving = savingIdx === i;
                    return (
                      <tr key={i} className={hasError ? "bg-red-50/60" : isSaved ? "bg-emerald-50/40" : "hover:bg-gray-50"}>
                        <td className="px-2 py-1 text-gray-400 align-middle">{i + 1}</td>
                        <td className="px-1 py-1 align-middle">
                          <input value={row.companyName} onChange={(e) => updateField(i, "companyName", e.target.value)} className={`${inputCls} font-medium text-gray-900`} placeholder="필수" />
                          {hasError && <div className="text-[10px] text-red-500 px-1.5">{row._error}</div>}
                        </td>
                        <td className="px-1 py-1 align-middle"><input value={row.submissionEntity} onChange={(e) => updateField(i, "submissionEntity", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.contactName} onChange={(e) => updateField(i, "contactName", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input type="email" value={row.email} onChange={(e) => updateField(i, "email", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.phone} onChange={(e) => updateField(i, "phone", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.fax} onChange={(e) => updateField(i, "fax", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.defaultAdditionalRate} onChange={(e) => updateField(i, "defaultAdditionalRate", e.target.value)} className={`${inputCls} text-right font-mono`} placeholder="0" /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.notes} onChange={(e) => updateField(i, "notes", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 text-center align-middle">
                          <button onClick={() => saveOne(i)} disabled={hasError || isSaving}
                            className={`text-[11px] px-2 py-1 rounded font-medium ${isSaved ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400"}`}>
                            {isSaving ? "..." : isSaved ? "저장됨 ↻" : "저장"}
                          </button>
                        </td>
                        <td className="px-1 py-1 text-center align-middle">
                          <button onClick={() => deleteRow(i)} className="text-gray-300 hover:text-red-500" title="행 제거"><X className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    );
                  })}
                  {previewFiltered.length === 0 && previewQuery && (
                    <tr><td colSpan={11} className="py-10 text-center text-gray-400 text-sm">검색 결과가 없어요.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Current status tab */}
        {activeTab === "current" && (
          currentLoading ? (
            <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>
          ) : currentRows.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">등록된 제출처가 없어요.</div>
          ) : (
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-xs min-w-[1180px]">
                {tableHead}
                <tbody className="divide-y divide-gray-100">
                  {currentFiltered.map((row, idx) => {
                    const isSaved = currentSavedSet.has(row.companyName);
                    const hasError = !!row._error;
                    const isSaving = currentSavingName === row.companyName;
                    return (
                      <tr
                        key={row.companyName}
                        className={hasError ? "bg-red-50/60" : isSaved ? "bg-emerald-50/40" : "hover:bg-gray-50"}
                        onBlur={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !hasError && !isSaving) {
                            saveCurrentRow(row);
                          }
                        }}
                      >
                        <td className="px-2 py-1 text-gray-400 align-middle">{idx + 1}</td>
                        <td className="px-1 py-1 align-middle">
                          <span className="px-1.5 py-1 text-xs font-medium text-gray-900">{row.companyName}</span>
                        </td>
                        <td className="px-1 py-1 align-middle"><input value={row.submissionEntity} onChange={(e) => updateCurrentField(row.companyName, "submissionEntity", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.contactName} onChange={(e) => updateCurrentField(row.companyName, "contactName", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input type="email" value={row.email} onChange={(e) => updateCurrentField(row.companyName, "email", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.phone} onChange={(e) => updateCurrentField(row.companyName, "phone", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.fax} onChange={(e) => updateCurrentField(row.companyName, "fax", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.defaultAdditionalRate} onChange={(e) => updateCurrentField(row.companyName, "defaultAdditionalRate", e.target.value)} className={`${inputCls} text-right font-mono`} placeholder="0" /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.notes} onChange={(e) => updateCurrentField(row.companyName, "notes", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 text-center align-middle">
                          <button onClick={() => saveCurrentRow(row)} disabled={hasError || isSaving}
                            className={`text-[11px] px-2 py-1 rounded font-medium ${isSaved ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400"}`}>
                            {isSaving ? "..." : isSaved ? "저장됨 ↻" : "저장"}
                          </button>
                        </td>
                        <td className="px-1 py-1 text-center align-middle">
                          <button onClick={() => deleteCurrentRow(row.companyName)} className="text-gray-300 hover:text-red-500" title="삭제"><X className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    );
                  })}
                  {currentFiltered.length === 0 && currentQuery && (
                    <tr><td colSpan={11} className="py-10 text-center text-gray-400 text-sm">검색 결과가 없어요.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {result && (
        <div className={`rounded-lg border p-4 ${result.errors.length > 0 ? "bg-yellow-50 border-yellow-200" : "bg-green-50 border-green-200"}`}>
          <div className="flex items-center gap-2 mb-2">
            {result.errors.length > 0
              ? <AlertCircle className="w-4 h-4 text-yellow-600" />
              : <CheckCircle className="w-4 h-4 text-green-600" />}
            <span className="text-sm font-medium text-gray-800">
              신규 등록 {result.created}건 · 수정 {result.updated}건
              {result.errors.length > 0 ? ` · 오류 ${result.errors.length}건` : " 완료"}
            </span>
          </div>
          {result.errors.length > 0 && (
            <ul className="text-xs text-red-700 space-y-0.5 ml-6 list-disc max-h-40 overflow-y-auto">
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
