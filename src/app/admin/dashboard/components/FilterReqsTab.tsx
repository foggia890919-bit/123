"use client";

import { useState, useEffect } from "react";
import { Download, RefreshCw, Search, X } from "lucide-react";
import * as XLSX from "xlsx";
import { CompanySubmission, FilterReq, statusOptions } from "./types";

export default function FilterReqsTab() {
  const [reqs, setReqs] = useState<FilterReq[]>([]);
  const [subs, setSubs] = useState<Map<string, CompanySubmission>>(new Map());
  const [loading, setLoading] = useState(true);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const [r1, r2] = await Promise.all([
      fetch("/api/filter-request?all=true").then((r) => r.json()),
      fetch("/api/admin/company-submissions").then((r) => r.json()),
    ]);
    setReqs(Array.isArray(r1) ? r1 : []);
    setSubs(new Map(Array.isArray(r2) ? r2.map((s: CompanySubmission) => [s.companyName, s]) : []));
    setLoading(false);
  }

  async function fetchReqs() {
    const res = await fetch("/api/filter-request?all=true");
    setReqs(await res.json());
  }

  async function updateStatus(id: string, status: string) {
    await fetch("/api/filter-request", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setReqs((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
  }

  async function sendReply(id: string) {
    const text = (replyDraft[id] ?? "").trim();
    if (!text) return;
    setSavingId(id);
    const res = await fetch("/api/filter-request", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, replyText: text }),
    });
    if (res.ok) {
      const updated = await res.json();
      setReqs((prev) => prev.map((r) => r.id === id ? { ...r, replyText: updated.replyText, repliedAt: updated.repliedAt } : r));
      setReplyDraft((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
    setSavingId(null);
  }

  const statusCounts: Record<string, number> = { ALL: reqs.length };
  for (const s of statusOptions) statusCounts[s.value] = 0;
  for (const r of reqs) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

  const filtered = reqs.filter((r) => {
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (r.user.name || r.userName || "").toLowerCase().includes(q) ||
      r.user.email.toLowerCase().includes(q) ||
      r.clientName.toLowerCase().includes(q) ||
      r.bizNumber.includes(query) ||
      r.companyName.toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function handleQueryChange(v: string) { setQuery(v); setPage(1); }
  function handleStatusChange(v: string) { setStatusFilter(v); setPage(1); }
  function handlePageSizeChange(v: number) { setPageSize(v); setPage(1); }

  function exportExcel() {
    const rows = filtered.map((r) => {
      const sub = subs.get(r.companyName);
      return {
        영업사원명: r.user.name || r.userName,
        아이디: r.user.email,
        거래처명: r.clientName,
        사업자번호: r.bizNumber,
        "요청 제약사": r.companyName,
        "제출처 법인명": sub?.submissionEntity || "",
        "추가수수료(%)": sub?.defaultAdditionalRate ?? "",
        요청일: new Date(r.createdAt).toLocaleString("ko-KR"),
        상태: statusOptions.find((s) => s.value === r.status)?.label || r.status,
        회신: r.replyText || "",
        회신일: r.repliedAt ? new Date(r.repliedAt).toLocaleString("ko-KR") : "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 10 }, { wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 18 },
      { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 40 }, { wch: 18 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "필터링요청");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `필터링요청_${statusFilter === "ALL" ? "전체" : statusOptions.find((s) => s.value === statusFilter)?.label}_${stamp}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">영업사원 필터링 요청 ({filtered.length}/{reqs.length}건)</h2>
            <p className="text-xs text-gray-400 mt-0.5">영업사원이 요청한 제약사 거래 조회 현황입니다.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder="영업사원·거래처·사업자번호·제약사 검색"
                className="h-9 w-72 border border-gray-200 rounded pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {query && (
                <button onClick={() => handleQueryChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="h-9 border border-gray-200 rounded px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {[10, 20, 30, 50, 100].map((n) => <option key={n} value={n}>{n}개씩</option>)}
            </select>
            <button
              onClick={exportExcel}
              disabled={filtered.length === 0}
              className="h-9 px-3 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:bg-gray-300 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />엑셀
            </button>
            <button onClick={fetchReqs} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />새로고침
            </button>
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => handleStatusChange("ALL")}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
              statusFilter === "ALL" ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >전체 <span className="opacity-70">({statusCounts.ALL})</span></button>
          {statusOptions.map((s) => (
            <button
              key={s.value}
              onClick={() => handleStatusChange(s.value)}
              className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                statusFilter === s.value ? `${s.cls} ring-2 ring-offset-1 ring-current/20` : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >{s.label} <span className="opacity-70">({statusCounts[s.value] || 0})</span></button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
              <th className="px-4 py-3 text-left">영업사원명</th>
              <th className="px-4 py-3 text-left">아이디(이메일)</th>
              <th className="px-4 py-3 text-left">거래처명</th>
              <th className="px-4 py-3 text-left">사업자번호</th>
              <th className="px-4 py-3 text-left">요청 제약사</th>
              <th className="px-4 py-3 text-left">제출처</th>
              <th className="px-4 py-3 text-center">요청일</th>
              <th className="px-4 py-3 text-center">상태</th>
              <th className="px-4 py-3 text-left min-w-[280px]">회신</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pageRows.map((req) => {
              const statusOpt = statusOptions.find((s) => s.value === req.status) || statusOptions[0];
              const draft = replyDraft[req.id] ?? "";
              const sub = subs.get(req.companyName);
              return (
                <tr key={req.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-3 font-medium text-gray-900">{req.user.name || req.userName}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{req.user.email}</td>
                  <td className="px-4 py-3 text-gray-700">{req.clientName}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">{req.bizNumber}</td>
                  <td className="px-4 py-3 text-gray-800">{req.companyName}</td>
                  <td className="px-4 py-3 text-xs">
                    {sub ? (
                      <div className="space-y-0.5">
                        {sub.submissionEntity && <div className="font-medium text-gray-800">{sub.submissionEntity}</div>}
                        {sub.contactName && <div className="text-gray-500">{sub.contactName}</div>}
                        {sub.email && <div className="text-blue-600 truncate max-w-[140px]">{sub.email}</div>}
                        {sub.defaultAdditionalRate != null && (
                          <div className="text-emerald-600 font-medium">+{sub.defaultAdditionalRate}%</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-300 text-[11px]">미등록</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-400 text-xs">{new Date(req.createdAt).toLocaleDateString("ko-KR")}</td>
                  <td className="px-4 py-3 text-center">
                    <select
                      value={req.status}
                      onChange={(e) => updateStatus(req.id, e.target.value)}
                      className={`text-xs px-2 py-1 rounded border font-medium ${statusOpt.cls} focus:outline-none cursor-pointer`}
                    >
                      {statusOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {req.replyText ? (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-700 whitespace-pre-wrap bg-blue-50 border border-blue-100 rounded px-2 py-1.5">{req.replyText}</p>
                        <div className="flex items-center gap-2 text-[11px] text-gray-400">
                          <span>{req.repliedAt ? new Date(req.repliedAt).toLocaleString("ko-KR") : ""}</span>
                          <button
                            type="button"
                            onClick={() => setReplyDraft((p) => ({ ...p, [req.id]: req.replyText || "" }))}
                            className="text-blue-500 hover:text-blue-700"
                          >수정</button>
                        </div>
                        {replyDraft[req.id] !== undefined && (
                          <div className="space-y-1">
                            <textarea
                              value={draft}
                              onChange={(e) => setReplyDraft((p) => ({ ...p, [req.id]: e.target.value }))}
                              placeholder="회신 내용"
                              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 min-h-[56px] focus:outline-none focus:border-blue-400"
                            />
                            <div className="flex gap-1 justify-end">
                              <button
                                type="button"
                                onClick={() => setReplyDraft((p) => { const n = { ...p }; delete n[req.id]; return n; })}
                                className="text-[11px] text-gray-500 hover:text-gray-700 px-2 py-1"
                              >취소</button>
                              <button
                                type="button"
                                onClick={() => sendReply(req.id)}
                                disabled={!draft.trim() || savingId === req.id}
                                className="text-[11px] text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 rounded px-2 py-1"
                              >{savingId === req.id ? "저장 중..." : "저장"}</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <textarea
                          value={draft}
                          onChange={(e) => setReplyDraft((p) => ({ ...p, [req.id]: e.target.value }))}
                          placeholder="회신 내용 (영업사원에게 표시됨)"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 min-h-[56px] focus:outline-none focus:border-blue-400"
                        />
                        <button
                          type="button"
                          onClick={() => sendReply(req.id)}
                          disabled={!draft.trim() || savingId === req.id}
                          className="text-[11px] text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 rounded px-2 py-1 ml-auto block"
                        >{savingId === req.id ? "저장 중..." : "회신 보내기"}</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={9} className="py-12 text-center text-gray-400 text-sm">
                {query ? "검색 결과가 없어요." : "요청 내역이 없어요."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-600">
          <span className="text-xs text-gray-400">{(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} / {filtered.length}건</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)} disabled={safePage === 1}
              className="px-2 py-1 rounded text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >«</button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
              className="px-2 py-1 rounded text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >‹</button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(safePage - 3, totalPages - 6));
              return start + i;
            }).map((n) => (
              <button
                key={n} onClick={() => setPage(n)}
                className={`px-2.5 py-1 rounded text-xs border ${n === safePage ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 hover:bg-gray-50"}`}
              >{n}</button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
              className="px-2 py-1 rounded text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >›</button>
            <button
              onClick={() => setPage(totalPages)} disabled={safePage === totalPages}
              className="px-2 py-1 rounded text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >»</button>
          </div>
        </div>
      )}
    </div>
  );
}
