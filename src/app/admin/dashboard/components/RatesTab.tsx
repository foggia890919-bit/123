"use client";

import { useState, useEffect, useRef } from "react";
import { CheckCircle, AlertCircle, Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { User, RateRow } from "./types";

export default function RatesTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; count?: number; saved?: number; samples?: RateRow[]; mode?: string; rate?: number; error?: string } | null>(null);
  const [currentRates, setCurrentRates] = useState<RateRow[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [bulkValue, setBulkValue] = useState("1");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/users?limit=200")
      .then((r) => r.json())
      .then((data) => setUsers(Array.isArray(data) ? data : (data.users ?? [])));
  }, []);

  async function loadCurrentRates(userId: string) {
    if (!userId) { setCurrentRates([]); return; }
    setRatesLoading(true);
    try {
      const res = await fetch(`/api/admin/rates?userId=${userId}`);
      const data: RateRow[] = await res.json();
      setCurrentRates(data);
    } finally { setRatesLoading(false); }
  }

  useEffect(() => { loadCurrentRates(selectedUser); }, [selectedUser]);

  async function downloadTemplate() {
    if (!selectedUser) return alert("회원을 먼저 선택해주세요.");
    const res = await fetch("/api/admin/rates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selectedUser }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const user = users.find((u) => u.id === selectedUser);
    a.download = `${user?.name || "회원"}_추가수수료.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function uploadRates(file: File) {
    if (!selectedUser) return alert("회원을 먼저 선택해주세요.");
    setUploading(true); setResult(null);
    const formData = new FormData();
    formData.append("userId", selectedUser);
    formData.append("file", file);
    try {
      const res = await fetch("/api/admin/rates", { method: "POST", body: formData });
      const data = await res.json();
      setResult(data);
      if (data.success) await loadCurrentRates(selectedUser);
    } catch { setResult({ error: "업로드 오류" }); }
    finally { setUploading(false); }
  }

  async function bulkSet() {
    if (!selectedUser) return alert("회원을 먼저 선택해주세요.");
    const n = Number(bulkValue);
    if (isNaN(n)) return alert("숫자를 입력해주세요.");
    if (!confirm(`${users.find((u) => u.id === selectedUser)?.name}의 모든 정산제약사에 추가수수료 ${n}%를 일괄 적용할까요?`)) return;
    setUploading(true); setResult(null);
    try {
      const res = await fetch("/api/admin/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUser, bulkRate: n }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) await loadCurrentRates(selectedUser);
    } catch { setResult({ error: "일괄설정 오류" }); }
    finally { setUploading(false); }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">회원별 추가수수료 관리</h2>
        <p className="text-sm text-gray-500">회원 선택 → 엑셀 다운로드 → B열에 추가수수료 입력 → 업로드</p>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">회원 선택</label>
          <select
            value={selectedUser}
            onChange={(e) => { setSelectedUser(e.target.value); setResult(null); }}
            className="w-full h-10 rounded-md border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">-- 회원 선택 --</option>
            {users.filter((u) => u.approved).map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <Button onClick={downloadTemplate} disabled={!selectedUser} variant="outline" className="flex-1">
            <Download className="w-4 h-4 mr-2" />
            제약사 목록 엑셀 다운로드
          </Button>
          <Button onClick={() => fileRef.current?.click()} disabled={!selectedUser} className="flex-1 bg-gray-800 hover:bg-gray-700">
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            {uploading ? "업로드 중..." : "수수료 엑셀 업로드"}
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadRates(f); }} />
        </div>

        <div className="flex items-end gap-2 bg-amber-50 border border-amber-200 rounded p-3">
          <div>
            <label className="text-xs font-medium text-amber-800 block mb-1">전체 정산제약사 일괄 추가수수료</label>
            <input
              type="number"
              step="0.1"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              className="h-9 w-24 rounded border border-amber-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <span className="ml-2 text-sm text-amber-700">%</span>
          </div>
          <Button onClick={bulkSet} disabled={!selectedUser || uploading} className="bg-amber-600 hover:bg-amber-700">
            전체 일괄 적용
          </Button>
        </div>

        <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700 space-y-1">
          <p className="font-medium">엑셀 작성 방법</p>
          <p>• A열: 제약사명 (다운로드한 그대로 유지)</p>
          <p>• B열: 추가수수료(%) 숫자 입력 (예: 2.5)</p>
          <p>• 0이면 추가수수료 없음, 입력한 수치가 기본수수료에 더해져 합계수수료가 됩니다</p>
        </div>

        {result && (
          <div className={`p-3 rounded-lg text-sm space-y-1 ${result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {result.success ? (
              <>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  {result.mode === "bulk"
                    ? <>일괄 적용 완료: <strong>{result.count}개 제약사</strong>에 <strong>{result.rate}%</strong> 설정</>
                    : <>엑셀 업로드 완료: <strong>{result.count}개</strong> 반영, DB 누적 <strong>{result.saved}개</strong></>}
                </div>
                {result.samples && result.samples.length > 0 && (
                  <div className="text-xs text-green-600 pl-6">
                    샘플: {result.samples.map((s) => `${s.companyName}(${s.additionalRate}%)`).join(", ")}
                  </div>
                )}
              </>
            ) : <><AlertCircle className="w-4 h-4 shrink-0" />{result.error}</>}
          </div>
        )}

        {/* 현재 저장된 추가수수료 목록 */}
        {selectedUser && (
          <div className="border border-gray-200 rounded-lg">
            <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">
                현재 저장된 추가수수료 ({currentRates.filter((r) => r.additionalRate !== 0).length} / {currentRates.length}개 제약사)
              </h3>
              <button onClick={() => loadCurrentRates(selectedUser)} className="text-xs text-gray-500 hover:text-gray-800">
                <RefreshCw className="w-3 h-3 inline mr-0.5" />새로고침
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {ratesLoading ? (
                <p className="text-xs text-gray-400 py-6 text-center">불러오는 중...</p>
              ) : currentRates.length === 0 ? (
                <p className="text-xs text-gray-400 py-6 text-center">저장된 수수료가 없어요.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500">
                      <th className="px-3 py-2 text-left">제약사명</th>
                      <th className="px-3 py-2 text-right w-24">추가수수료</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {currentRates.map((r) => (
                      <tr key={r.companyName}>
                        <td className="px-3 py-1.5 text-gray-700">{r.companyName}</td>
                        <td className={`px-3 py-1.5 text-right font-mono ${r.additionalRate ? "text-blue-700 font-semibold" : "text-gray-300"}`}>
                          {r.additionalRate}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
