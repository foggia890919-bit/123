"use client";

import { useState, useEffect } from "react";
import { Upload, Loader2, Trash2, Plus, Calendar } from "lucide-react";

interface Deadline {
  id: string;
  companyName: string;
  yearMonth: string;
  deadline: string;
  source: string;
  memo: string | null;
  createdAt: string;
}

interface ExtractedRow {
  companyName: string;
  yearMonth: string;
  deadline: string;
  rawText: string;
}

export default function CompanyDeadlinesPage() {
  const [list, setList] = useState<Deadline[]>([]);
  const [loading, setLoading] = useState(false);
  const [yearMonth, setYearMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [uploading, setUploading] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedRow[]>([]);
  const [ocrYearMonth, setOcrYearMonth] = useState<string>("");
  const [errors, setErrors] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newRow, setNewRow] = useState({ companyName: "", deadline: "" });

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/company-deadlines?yearMonth=${yearMonth}`);
      const data = await r.json();
      setList(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [yearMonth]);

  async function handleFile(file: File) {
    setUploading(true);
    setExtracted([]);
    setErrors([]);
    try {
      const reader = new FileReader();
      const dataUri: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await fetch("/api/admin/company-deadlines/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUri, autoSave: true }),
      });
      const data = await r.json();
      if (!r.ok) {
        setErrors([data.error ?? `HTTP ${r.status}`]);
        return;
      }
      setExtracted(data.extractedRows ?? []);
      setOcrYearMonth(data.yearMonth ?? "");
      setErrors(data.errors ?? []);
      load();
    } catch (e) {
      setErrors([String(e)]);
    } finally {
      setUploading(false);
    }
  }

  async function addManual() {
    if (!newRow.companyName || !newRow.deadline) return;
    await fetch("/api/admin/company-deadlines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: newRow.companyName,
        yearMonth,
        deadline: newRow.deadline,
      }),
    });
    setNewRow({ companyName: "", deadline: "" });
    setShowAdd(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch(`/api/admin/company-deadlines?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">제약사별 통계제출 마감일</h1>

      {/* 적용월 + 액션 */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm font-medium text-gray-600 flex items-center gap-2">
          <Calendar className="w-4 h-4" />적용월
        </label>
        <input
          type="month"
          value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 cursor-pointer">
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "OCR 분석 중..." : "마감일 이미지 업로드"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            disabled={uploading}
          />
        </label>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <Plus className="w-3.5 h-3.5" />수동 추가
        </button>
      </div>

      {uploading && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />Gemini 비전으로 마감일 추출 중...
        </div>
      )}

      {extracted.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs space-y-1">
          <div className="font-semibold text-green-800">
            ✓ OCR 추출 {extracted.length}건 (적용월: {ocrYearMonth || "?"}) — 자동 저장 완료
          </div>
          {errors.length > 0 && (
            <div className="text-red-700">
              에러 {errors.length}건: {errors.slice(0, 3).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* 수동 추가 폼 */}
      {showAdd && (
        <div className="bg-white border rounded-lg p-4 flex items-end gap-3">
          <div>
            <label className="text-xs text-gray-500">제약사명</label>
            <input
              value={newRow.companyName}
              onChange={(e) => setNewRow({ ...newRow, companyName: e.target.value })}
              placeholder="예: 대웅제약"
              className="block border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">마감일시</label>
            <input
              type="datetime-local"
              value={newRow.deadline}
              onChange={(e) => setNewRow({ ...newRow, deadline: e.target.value })}
              className="block border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button onClick={addManual} className="px-3 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
            저장
          </button>
          <button onClick={() => setShowAdd(false)} className="px-3 py-2 text-xs text-gray-600">
            취소
          </button>
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />조회 중...
        </div>
      ) : list.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {yearMonth} 등록된 마감일이 없습니다
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-lg bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-xs text-gray-500">
                <th className="text-left px-4 py-3">제약사</th>
                <th className="text-left px-3 py-3">적용월</th>
                <th className="text-left px-3 py-3">마감일시</th>
                <th className="text-center px-3 py-3">출처</th>
                <th className="text-left px-3 py-3">메모</th>
                <th className="text-center px-4 py-3">삭제</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{d.companyName}</td>
                  <td className="px-3 py-2.5 text-gray-600 tabular-nums">{d.yearMonth}</td>
                  <td className="px-3 py-2.5 text-gray-700 tabular-nums">
                    {new Date(d.deadline).toLocaleString("ko-KR")}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      d.source === "GEMINI_OCR"
                        ? "bg-blue-50 border-blue-200 text-blue-700"
                        : "bg-gray-50 border-gray-200 text-gray-500"
                    }`}>
                      {d.source === "GEMINI_OCR" ? "AI인식" : "수동"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 truncate max-w-[200px]">
                    {d.memo ?? "-"}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => remove(d.id)} className="text-gray-400 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
