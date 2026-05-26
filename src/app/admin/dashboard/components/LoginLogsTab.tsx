"use client";

import { useState, useEffect } from "react";
import { CheckCircle, AlertCircle, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoginLogEntry, roleLabel, roleColor } from "./types";

export default function LoginLogsTab() {
  const [logs, setLogs] = useState<LoginLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [successFilter, setSuccessFilter] = useState<"" | "true" | "false">("");

  async function loadLogs(p = page, q = query, success = successFilter) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (q) params.set("q", q);
      if (success) params.set("success", success);
      const res = await fetch(`/api/admin/login-logs?${params}`);
      const data = await res.json();
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadLogs(1); }, []);

  function handleSearch() {
    setPage(1);
    loadLogs(1, query, successFilter);
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-bold text-gray-900 mb-4">로그인 기록</h2>

        {/* 필터 */}
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="이름 · 이메일 · 전화번호 검색"
            className="h-9 px-3 border border-gray-300 rounded-md text-sm w-72"
          />
          <select
            value={successFilter}
            onChange={(e) => setSuccessFilter(e.target.value as "" | "true" | "false")}
            className="h-9 px-3 border border-gray-300 rounded-md text-sm bg-white"
          >
            <option value="">전체</option>
            <option value="true">성공</option>
            <option value="false">실패</option>
          </select>
          <Button size="sm" onClick={handleSearch} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span className="ml-1">조회</span>
          </Button>
          <span className="ml-auto text-xs text-gray-500 self-center">총 {total.toLocaleString()}건</span>
        </div>

        {/* 테이블 */}
        <div className="overflow-auto rounded-lg border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 font-semibold">
              <tr>
                <th className="px-4 py-2.5 text-left">시각</th>
                <th className="px-4 py-2.5 text-left">이름</th>
                <th className="px-4 py-2.5 text-left">이메일</th>
                <th className="px-4 py-2.5 text-left">전화번호</th>
                <th className="px-4 py-2.5 text-left">역할</th>
                <th className="px-4 py-2.5 text-center">결과</th>
                <th className="px-4 py-2.5 text-left">IP</th>
                <th className="px-4 py-2.5 text-left">브라우저</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">기록이 없습니다.</td></tr>
              )}
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString("ko-KR")}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-800 font-medium">{log.user?.name ?? "-"}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{log.email}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{log.user?.phone ?? "-"}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {log.user ? (
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${roleColor[log.user.role] ?? "bg-gray-100 text-gray-600"}`}>
                        {roleLabel[log.user.role] ?? log.user.role}
                      </span>
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {log.success
                      ? <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium"><CheckCircle className="w-3.5 h-3.5" />성공</span>
                      : <span className="inline-flex items-center gap-1 text-red-500 text-xs font-medium"><AlertCircle className="w-3.5 h-3.5" />실패</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{log.ip ?? "-"}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 max-w-[200px] truncate" title={log.userAgent ?? ""}>
                    {log.userAgent ? log.userAgent.replace(/\(.*?\)/g, "").trim().slice(0, 60) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 mt-4">
            <button onClick={() => { setPage(p => { const np = Math.max(1, p-1); loadLogs(np); return np; })} } disabled={page === 1}
              className="px-2 py-1 text-xs border rounded disabled:opacity-40">이전</button>
            {Array.from({ length: Math.min(10, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 4, totalPages - 9));
              const p = start + i;
              return (
                <button key={p} onClick={() => { setPage(p); loadLogs(p); }}
                  className={`px-2.5 py-1 text-xs border rounded ${p === page ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"}`}>
                  {p}
                </button>
              );
            })}
            <button onClick={() => { setPage(p => { const np = Math.min(totalPages, p+1); loadLogs(np); return np; })}} disabled={page === totalPages}
              className="px-2 py-1 text-xs border rounded disabled:opacity-40">다음</button>
          </div>
        )}
      </div>
    </div>
  );
}
