"use client";

import { useState, useEffect } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { CorpRow } from "./types";

export default function CorpRelationTab() {
  const [allClients, setAllClients] = useState<CorpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/user-clients?allMembers=true")
      .then((r) => r.json())
      .then((data) => setAllClients(data as CorpRow[]))
      .catch(() => setAllClients([]))
      .finally(() => setLoading(false));
  }, []);

  // only UserClient rows (id !== null) can participate in parent/child hierarchy
  const corps = allClients.filter((c) => !c.isUserOnly);

  const filtered = allClients.filter((c) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      (c.clientName ?? "").toLowerCase().includes(q) ||
      (c.bizNumber ?? "").includes(q) ||
      (c.user.name ?? "").toLowerCase().includes(q) ||
      c.user.email.toLowerCase().includes(q)
    );
  });

  async function patchParent(childId: string | null, parentId: string | null) {
    if (!childId) return;
    setSaving(childId);
    try {
      const res = await fetch(`/api/user-clients?id=${childId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorpId: parentId }),
      });
      if (res.ok) {
        setAllClients((prev) =>
          prev.map((c) => (c.id === childId ? { ...c, parentCorpId: parentId } : c))
        );
        const parentName = parentId ? allClients.find((c) => c.id === parentId)?.clientName : null;
        setToast(parentName ? `상위법인 → ${parentName}` : "상위법인 해제");
        setTimeout(() => setToast(null), 2000);
      }
    } finally {
      setSaving(null);
    }
  }

  const dealerLabel: Record<string, string> = {
    UPPER_CORP: "상위법인", LOWER_CORP: "하위법인", CORPORATION: "법인",
    INDIVIDUAL: "개인사업자", SELF: "자사",
  };
  const dealerColor: Record<string, string> = {
    UPPER_CORP: "bg-purple-100 text-purple-700", LOWER_CORP: "bg-blue-100 text-blue-700",
    CORPORATION: "bg-indigo-100 text-indigo-700", INDIVIDUAL: "bg-orange-100 text-orange-700",
    SELF: "bg-gray-100 text-gray-600",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            상위 하위법인 지정{" "}
            <span className="text-base font-normal text-gray-400">({allClients.length}명)</span>
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">회원 1명당 1행. 사업자 등록된 회원만 상위/하위 법인으로 지정할 수 있어요 (사업자 미등록 회원은 드롭다운에서 비활성).</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="거래처명 / 사업자번호 검색"
            className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-72"
          />
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: "1100px" }}>
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600" rowSpan={2}>거래처명</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600" rowSpan={2}>사업자번호</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600" rowSpan={2}>유형</th>
              <th className="text-center px-4 py-2 font-medium text-gray-700 border-l border-gray-200" colSpan={2}>상위법인</th>
              <th className="text-center px-4 py-2 font-medium text-gray-700 border-l border-gray-200" colSpan={2}>하위법인</th>
            </tr>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs border-l border-gray-200 w-36">현황</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs w-44">지정 변경</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs border-l border-gray-200 w-40">현황</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs w-44">지정 추가</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-16 text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                  불러오는 중...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-16 text-gray-400">
                  {query ? "검색 결과가 없어요." : "등록된 사업자가 없어요."}
                </td>
              </tr>
            ) : (
              filtered.map((c, idx) => {
                const parent = c.id ? corps.find((x) => x.id === c.parentCorpId) : undefined;
                const children = c.id ? corps.filter((x) => x.parentCorpId === c.id) : [];
                const addableChildren = c.id ? corps.filter((x) => x.id !== c.id && x.parentCorpId !== c.id) : [];
                const isSaving = saving === c.id;
                const isChildSaving = children.some((ch) => saving === ch.id);
                const rowKey = c.id ?? `user-${c.userId}-${idx}`;

                if (c.isUserOnly) {
                  return (
                    <tr key={rowKey} className="hover:bg-gray-50 transition-colors align-middle bg-gray-50/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-700">{c.user.name ?? "(이름 없음)"}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{c.user.phone ?? c.user.email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">—</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-400">사업자 미등록</span>
                      </td>
                      <td className="px-4 py-3 border-l border-gray-100 text-xs text-gray-400">—</td>
                      <td className="px-4 py-3 text-xs text-gray-400">—</td>
                      <td className="px-4 py-3 border-l border-gray-100 text-xs text-gray-400">—</td>
                      <td className="px-4 py-3 text-xs text-gray-400">—</td>
                    </tr>
                  );
                }

                return (
                  <tr key={rowKey} className="hover:bg-gray-50 transition-colors align-middle">
                    {/* 거래처명 */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {c.clientName}
                        {c.extraBizCount && c.extraBizCount > 0 ? (
                          <span className="ml-1 text-xs text-gray-400 font-normal">외 {c.extraBizCount}건</span>
                        ) : null}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{c.user.name} · {c.user.phone ?? c.user.email}</div>
                    </td>
                    {/* 사업자번호 */}
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{c.bizNumber}</td>
                    {/* 유형 */}
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${dealerColor[c.dealerType ?? ""] ?? "bg-green-100 text-green-700"}`}>
                        {dealerLabel[c.dealerType ?? ""] ?? "병의원(원외)"}
                      </span>
                    </td>

                    {/* 상위법인 현황 */}
                    <td className="px-4 py-3 border-l border-gray-100">
                      {parent ? (
                        <span className="text-sm font-medium text-purple-700">{parent.clientName}</span>
                      ) : (
                        <span className="text-xs text-gray-400">없음</span>
                      )}
                    </td>
                    {/* 상위법인 지정 변경 */}
                    <td className="px-4 py-3">
                      <select
                        value={c.parentCorpId ?? ""}
                        onChange={(e) => patchParent(c.id, e.target.value || null)}
                        disabled={isSaving}
                        className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-wait"
                      >
                        <option value="">없음</option>
                        {allClients.filter((x) => x.userId !== c.userId).map((x) => (
                          <option
                            key={x.id ?? `user-${x.userId}`}
                            value={x.id ?? ""}
                            disabled={x.isUserOnly}
                          >
                            {x.isUserOnly
                              ? `${x.user.name ?? "(이름 없음)"} (사업자 미등록)`
                              : x.clientName}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* 하위법인 현황 */}
                    <td className="px-4 py-3 border-l border-gray-100">
                      {children.length === 0 ? (
                        <span className="text-xs text-gray-400">없음</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {children.map((ch) => (
                            <span key={ch.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                              {ch.clientName}
                              <button
                                onClick={() => patchParent(ch.id, null)}
                                disabled={saving === ch.id}
                                className="text-blue-400 hover:text-red-500 disabled:opacity-50"
                                title="하위법인 해제"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    {/* 하위법인 지정 추가 */}
                    <td className="px-4 py-3">
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) patchParent(e.target.value, c.id); }}
                        disabled={isChildSaving}
                        className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-wait"
                      >
                        <option value="">+ 추가</option>
                        {allClients
                          .filter((x) => x.userId !== c.userId && x.parentCorpId !== c.id)
                          .map((x) => (
                            <option
                              key={x.id ?? `user-${x.userId}`}
                              value={x.id ?? ""}
                              disabled={x.isUserOnly}
                            >
                              {x.isUserOnly
                                ? `${x.user.name ?? "(이름 없음)"} (사업자 미등록)`
                                : x.clientName}
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
