"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Search } from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS, normalizeRole, type UserRole } from "@/lib/roles";

interface BizUser {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: string;
  createdAt: string;
  clientName: string | null;
  bizNumber: string | null;
}

interface Props {
  role: "HOSPITAL" | "PHARMACY" | "CSO" | "GENERAL" | "ALL";
  title: string;
  desc?: string;
}

export default function RoleUsersTab({ role, title, desc }: Props) {
  const [list, setList] = useState<BizUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const url = role === "ALL"
      ? "/api/biz/users-by-role"
      : `/api/biz/users-by-role?role=${role}`;
    fetch(url).then((r) => r.json())
      .then((d) => setList(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, [role]);
  useEffect(() => { load(); }, [load]);

  const filtered = query
    ? list.filter((u) =>
        (u.name ?? "").includes(query) ||
        u.email.includes(query) ||
        (u.phone ?? "").includes(query) ||
        (u.clientName ?? "").includes(query))
    : list;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-md flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름·이메일·전화·사업체명 검색"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
        </div>
        <span className="text-xs text-gray-500">{filtered.length}/{list.length}명</span>
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
                <th className="text-left px-3 py-3">사업체</th>
                <th className="text-left px-3 py-3">가입일</th>
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
                      {u.clientName ?? "-"}
                      {u.bizNumber && <div className="text-[10px] text-gray-400 tabular-nums">{u.bizNumber}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{new Date(u.createdAt).toLocaleDateString("ko-KR")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">해당 분류 회원이 없습니다</div>
          )}
        </div>
      )}
    </div>
  );
}
