"use client";

import { useState, useEffect, useCallback } from "react";
import { Briefcase, Loader2, Search } from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS, normalizeRole, type UserRole } from "@/lib/roles";

interface BizUser {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: string;
  createdAt: string;
  ownerClientName?: string | null;
  ownerBizNumber?: string | null;
}

type FilterTab = "ALL" | "BIZ" | "SALES";

export default function BusinessesTab() {
  const [list, setList] = useState<BizUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterTab>("ALL");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/businesses").then((r) => r.json())
      .then((d) => setList(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const byFilter = filter === "ALL" ? list : list.filter((u) => {
    const r = normalizeRole(u.role);
    if (filter === "BIZ") return r === "BIZ" || r === "ADMIN";
    if (filter === "SALES") return r === "SALES";
    return true;
  });
  const filtered = query
    ? byFilter.filter((u) =>
        (u.name ?? "").includes(query) ||
        u.email.includes(query) ||
        (u.phone ?? "").includes(query) ||
        (u.ownerClientName ?? "").includes(query) ||
        (u.ownerBizNumber ?? "").includes(query))
    : byFilter;

  const bizCount = list.filter((u) => { const r = normalizeRole(u.role); return r === "BIZ" || r === "ADMIN"; }).length;
  const salesCount = list.filter((u) => normalizeRole(u.role) === "SALES").length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-purple-600" />사업자관리
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          CSO 분류로 전환된 사업자(법인·영업사원). 신규회원은 회원관리에서 분류 후 여기로 이동됩니다.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {([
          { k: "ALL", label: "전체", count: list.length },
          { k: "BIZ", label: "CSO 법인 (BIZ/관리자)", count: bizCount },
          { k: "SALES", label: "CSO 영업사원", count: salesCount },
        ] as { k: FilterTab; label: string; count: number }[]).map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
              filter === f.k
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {f.label} <span className="ml-1 opacity-75">{f.count}</span>
          </button>
        ))}
        <div className="relative max-w-xs flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름·이메일·전화·사업자 검색"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto border rounded-lg bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-xs text-gray-500">
                <th className="text-left px-4 py-3">이름</th>
                <th className="text-left px-3 py-3">이메일</th>
                <th className="text-left px-3 py-3">전화</th>
                <th className="text-center px-3 py-3">권한</th>
                <th className="text-left px-3 py-3">본인 사업체</th>
                <th className="text-left px-3 py-3">전환일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((u) => {
                const nr = normalizeRole(u.role) as UserRole;
                return (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{u.name ?? "-"}</td>
                    <td className="px-3 py-2.5 text-gray-600">{u.email}</td>
                    <td className="px-3 py-2.5 text-gray-600">{u.phone ?? "-"}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${ROLE_COLORS[nr] ?? "bg-gray-100 text-gray-600"}`}>
                        {ROLE_LABELS[nr] ?? nr}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">
                      {u.ownerClientName ?? "-"}
                      {u.ownerBizNumber && <div className="text-[10px] text-gray-400">{u.ownerBizNumber}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{new Date(u.createdAt).toLocaleDateString("ko-KR")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">사업자가 없습니다</div>
          )}
        </div>
      )}
    </div>
  );
}
