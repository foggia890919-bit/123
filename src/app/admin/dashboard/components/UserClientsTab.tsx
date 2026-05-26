"use client";

import { useState, useEffect, useRef } from "react";
import { Upload, RefreshCw } from "lucide-react";
import { AdminUserClient } from "./types";

export default function UserClientsTab() {
  const [rows, setRows] = useState<AdminUserClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [clientTab, setClientTab] = useState<"approved" | "unapproved">("unapproved");
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/user-clients?all=true");
    const data = await res.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  const approvedRows = rows.filter((r) => r.approved);
  const unapprovedRows = rows.filter((r) => !r.approved);
  const baseRows = clientTab === "approved" ? approvedRows : unapprovedRows;

  const filtered = baseRows.filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (r.user.name || "").toLowerCase().includes(q) ||
      r.user.email.toLowerCase().includes(q) ||
      r.clientName.toLowerCase().includes(q) ||
      r.bizNumber.includes(query)
    );
  });

  const grouped = new Map<string, { user: AdminUserClient["user"]; clients: AdminUserClient[] }>();
  for (const row of filtered) {
    const prev = grouped.get(row.userId);
    if (prev) prev.clients.push(row);
    else grouped.set(row.userId, { user: row.user, clients: [row] });
  }

  async function toggleApproval(id: string, approved: boolean) {
    setApprovingId(id);
    await fetch(`/api/user-clients?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, approved } : r));
    setApprovingId(null);
  }

  async function downloadDoc(row: AdminUserClient) {
    let href = row.bizDocument;
    if (!href) {
      const res = await fetch(`/api/files/user-client/${row.id}`);
      if (!res.ok) { alert("문서를 불러오지 못했어요."); return; }
      const data = await res.json();
      href = data.bizDocument;
    }
    if (!href) return;
    const a = document.createElement("a");
    a.href = href;
    a.download = row.bizFileName || "bizDocument";
    a.click();
  }

  async function handleDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !uploadingId) return;
    const fr = new FileReader();
    fr.onload = async () => {
      const bizDocument = fr.result as string;
      const res = await fetch(`/api/user-clients?id=${uploadingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bizDocument, bizFileName: file.name }),
      });
      if (res.ok) {
        setRows((prev) => prev.map((r) => r.id === uploadingId ? { ...r, bizFileName: file.name, hasBizDocument: true } : r));
      }
      setUploadingId(null);
    };
    fr.readAsDataURL(file);
  }

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <input ref={uploadRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleDocUpload} />
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">담당자별 거래처 등록 현황 ({rows.length}건)</h2>
          <p className="text-xs text-gray-400 mt-0.5">영업사원이 등록한 거래처를 담당자별로 확인할 수 있어요.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="담당자 / 거래처명 / 사업자번호 검색"
            className="h-9 w-64 border border-gray-200 rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button onClick={load} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />새로고침
          </button>
        </div>
      </div>

      <div className="flex border-b border-gray-100">
        <button
          onClick={() => setClientTab("unapproved")}
          className={`text-sm px-5 py-2.5 border-b-2 font-medium transition-colors ${
            clientTab === "unapproved" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          미승인 거래처 <span className="text-xs opacity-70">({unapprovedRows.length})</span>
        </button>
        <button
          onClick={() => setClientTab("approved")}
          className={`text-sm px-5 py-2.5 border-b-2 font-medium transition-colors ${
            clientTab === "approved" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          승인 거래처 <span className="text-xs opacity-70">({approvedRows.length})</span>
        </button>
      </div>

      {filtered.length === 0 && !query ? (
        <p className="py-12 text-center text-gray-400 text-sm">
          {clientTab === "unapproved" ? "미승인 거래처가 없어요." : "승인된 거래처가 없어요."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                <th className="px-4 py-3 text-left">담당자</th>
                <th className="px-4 py-3 text-left">아이디(이메일)</th>
                <th className="px-4 py-3 text-left">거래처명</th>
                <th className="px-4 py-3 text-left">사업자번호</th>
                <th className="px-4 py-3 text-left">구분</th>
                <th className="px-4 py-3 text-left">사업자등록증</th>
                <th className="px-4 py-3 text-center">등록일</th>
                <th className="px-4 py-3 text-center">승인</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {Array.from(grouped.values()).map(({ user, clients }) => (
                clients.map((c, idx) => (
                  <tr key={c.id} className="hover:bg-gray-50 align-top">
                    {idx === 0 ? (
                      <>
                        <td rowSpan={clients.length} className="px-4 py-3 font-medium text-gray-900 border-r border-gray-100 bg-gray-50/40">
                          {user.name || "-"}
                          <div className="text-[10px] text-gray-400 font-normal mt-0.5">{clients.length}개 등록</div>
                        </td>
                        <td rowSpan={clients.length} className="px-4 py-3 text-gray-500 text-xs border-r border-gray-100 bg-gray-50/40">{user.email}</td>
                      </>
                    ) : null}
                    <td className="px-4 py-3 text-gray-800">{c.clientName}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs font-mono">{c.bizNumber}</td>
                    <td className="px-4 py-3 text-xs">
                      {c.dealerType ? (
                        <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded text-[10px] font-medium">{c.dealerType}</span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium">병의원</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="flex items-center gap-2">
                        {(c.bizDocument || c.hasBizDocument || c.bizFileName) ? (
                          <button onClick={() => downloadDoc(c)} className="text-blue-600 hover:underline">
                            {c.bizFileName || "다운로드"}
                          </button>
                        ) : <span className="text-gray-300">없음</span>}
                        <button
                          onClick={() => { setUploadingId(c.id); uploadRef.current?.click(); }}
                          className="text-gray-300 hover:text-blue-500 transition-colors"
                          title="사업자등록증 업로드"
                        >
                          <Upload className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-400 text-xs whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleApproval(c.id, !c.approved)}
                        disabled={approvingId === c.id}
                        className={`text-xs px-2.5 py-1.5 rounded font-medium transition-colors ${
                          c.approved
                            ? "bg-red-50 text-red-600 hover:bg-red-100"
                            : "bg-green-50 text-green-700 hover:bg-green-100"
                        }`}
                      >
                        {approvingId === c.id ? "..." : c.approved ? "승인취소" : "승인"}
                      </button>
                    </td>
                  </tr>
                ))
              ))}
              {filtered.length === 0 && query && (
                <tr><td colSpan={8} className="py-12 text-center text-gray-400 text-sm">검색 결과가 없어요.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
