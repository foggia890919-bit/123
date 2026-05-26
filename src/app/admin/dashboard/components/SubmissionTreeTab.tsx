"use client";

import { useState, useEffect, useMemo } from "react";
import { RefreshCw, Search, Loader2, Network, ChevronRight } from "lucide-react";
import { TreeResponse } from "./types";

export default function SubmissionTreeTab() {
  const [data, setData] = useState<TreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  function refresh() {
    setLoading(true);
    setError("");
    fetch("/api/admin/submission-tree")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d: TreeResponse) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "조회 실패"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { refresh(); }, []);

  function toggleParent(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function expandAll() {
    if (!data) return;
    setExpanded(new Set([...data.parents.map((p) => p.parent.id), "__unlinked__"]));
  }
  function collapseAll() { setExpanded(new Set()); }

  // 검색 — 상위회원, 하위회원, 거래처/제약사/제출처명 모두 매칭.
  const filteredParents = useMemo(() => {
    if (!data) return [];
    if (!query.trim()) return data.parents;
    const q = query.trim().toLowerCase();
    return data.parents.filter((p) => {
      if ((p.parent.name || "").toLowerCase().includes(q)) return true;
      if (p.parent.email.toLowerCase().includes(q)) return true;
      return p.children.some((c) => {
        if ((c.owner.name || "").toLowerCase().includes(q)) return true;
        if (c.owner.email.toLowerCase().includes(q)) return true;
        return c.routes.some((r) =>
          r.clientName.toLowerCase().includes(q) ||
          r.companyName.toLowerCase().includes(q) ||
          r.submissionEntity.toLowerCase().includes(q)
        );
      });
    });
  }, [data, query]);

  const filteredUnlinked = useMemo(() => {
    if (!data) return [];
    if (!query.trim()) return data.unlinked.owners;
    const q = query.trim().toLowerCase();
    return data.unlinked.owners.filter((c) => {
      if ((c.owner.name || "").toLowerCase().includes(q)) return true;
      if (c.owner.email.toLowerCase().includes(q)) return true;
      return c.routes.some((r) =>
        r.clientName.toLowerCase().includes(q) ||
        r.companyName.toLowerCase().includes(q) ||
        r.submissionEntity.toLowerCase().includes(q)
      );
    });
  }, [data, query]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Network className="w-5 h-5 text-indigo-500" />
        <h1 className="text-2xl font-bold text-gray-900">제출 트리</h1>
      </div>
      <p className="text-sm text-gray-500">
        상위회원(법인) ↔ 하위회원(영업사원/거래처) ↔ 매핑(거래처×제약사×제출처) 관계를 한눈에 봅니다.
        매핑은 회원 통계제출처에서 등록한 SubmissionRoute 입니다.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={refresh} disabled={loading}
          className="text-xs px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> 새로고침
        </button>
        <button onClick={expandAll} disabled={!data || loading}
          className="text-xs px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
          모두 펼치기
        </button>
        <button onClick={collapseAll} disabled={!data || loading}
          className="text-xs px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
          모두 접기
        </button>
        <div className="relative ml-auto">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="회원/거래처/제약사/제출처 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="text-xs pl-7 pr-2 py-1.5 border border-gray-300 rounded w-64 focus:outline-none focus:border-blue-400"
          />
        </div>
        {data && (
          <div className="text-xs text-gray-500 px-2">
            상위 {data.totals.parentCount}명 · 매핑 {data.totals.routeCount}건
            {data.totals.unlinkedRouteCount > 0 && <span className="text-amber-600"> · 미연결 {data.totals.unlinkedRouteCount}건</span>}
          </div>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">{error}</div>}

      {loading && !data ? (
        <div className="text-center py-12 text-gray-400 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> 트리 로딩 중...
        </div>
      ) : !data ? null : (
        <div className="space-y-3">
          {filteredParents.length === 0 && filteredUnlinked.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              {query ? "검색 결과가 없어요." : "등록된 제출처가 없어요."}
            </div>
          )}

          {filteredParents.map((p) => {
            const isOpen = expanded.has(p.parent.id);
            return (
              <div key={p.parent.id} className="bg-white border border-gray-200 rounded-lg">
                <button
                  onClick={() => toggleParent(p.parent.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
                >
                  <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-semibold">상위</span>
                    <span className="text-sm font-bold text-gray-900 truncate">{p.parent.name || p.parent.email.split("@")[0]}</span>
                    <span className="text-xs text-gray-500 truncate">{p.parent.email}</span>
                    {p.parent.isBusinessApproved && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px]">사업자</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
                    <span>하위 {p.childCount}명</span>
                    <span className="text-gray-300">·</span>
                    <span>매핑 {p.routeCount}건</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 px-4 py-3 space-y-3 bg-gray-50/50">
                    {p.children.map((c) => (
                      <div key={c.owner.id} className="bg-white border border-gray-200 rounded">
                        <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px] font-semibold">하위</span>
                          <span className="text-sm font-semibold text-gray-900">{c.owner.name || c.owner.email.split("@")[0]}</span>
                          <span className="text-xs text-gray-500">{c.owner.email}</span>
                          <span className="ml-auto text-[10px] text-gray-400">{c.routes.length}건</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {c.routes.map((r) => (
                            <div key={r.id} className="px-3 py-1.5 grid grid-cols-12 gap-2 text-xs items-center">
                              <span className="col-span-4 text-gray-800 truncate" title={r.clientName}>{r.clientName}</span>
                              <span className="col-span-1 text-gray-300 text-center">→</span>
                              <span className="col-span-3 text-gray-700 truncate" title={r.companyName}>{r.companyName}</span>
                              <span className="col-span-3 text-indigo-700 font-medium truncate" title={r.submissionEntity}>{r.submissionEntity}</span>
                              <span className="col-span-1 text-right">
                                {r.active
                                  ? <span className="px-1 py-0.5 rounded bg-green-50 text-green-700 text-[10px]">활성</span>
                                  : <span className="px-1 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px]">비활성</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* 미연결 매핑 — parentUserId=null. ADMIN 이 상위 지정을 안 했거나 자유 입력으로만 등록된 케이스. */}
          {filteredUnlinked.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-lg">
              <button
                onClick={() => toggleParent("__unlinked__")}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-50/50 text-left"
              >
                <ChevronRight className={`w-4 h-4 text-amber-500 transition-transform ${expanded.has("__unlinked__") ? "rotate-90" : ""}`} />
                <div className="flex items-center gap-2 flex-1 flex-wrap">
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">미연결</span>
                  <span className="text-sm font-bold text-amber-900">상위회원 미지정</span>
                  <span className="text-xs text-amber-700">— 자유 입력으로만 등록된 매핑</span>
                </div>
                <div className="text-xs text-amber-700 shrink-0">
                  {filteredUnlinked.length}명 · 매핑 {filteredUnlinked.reduce((s, c) => s + c.routes.length, 0)}건
                </div>
              </button>

              {expanded.has("__unlinked__") && (
                <div className="border-t border-amber-100 px-4 py-3 space-y-3 bg-amber-50/30">
                  {filteredUnlinked.map((c) => (
                    <div key={c.owner.id} className="bg-white border border-amber-200 rounded">
                      <div className="px-3 py-2 border-b border-amber-100 flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{c.owner.name || c.owner.email.split("@")[0]}</span>
                        <span className="text-xs text-gray-500">{c.owner.email}</span>
                        <span className="ml-auto text-[10px] text-gray-400">{c.routes.length}건</span>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {c.routes.map((r) => (
                          <div key={r.id} className="px-3 py-1.5 grid grid-cols-12 gap-2 text-xs items-center">
                            <span className="col-span-4 text-gray-800 truncate" title={r.clientName}>{r.clientName}</span>
                            <span className="col-span-1 text-gray-300 text-center">→</span>
                            <span className="col-span-3 text-gray-700 truncate" title={r.companyName}>{r.companyName}</span>
                            <span className="col-span-3 text-amber-700 truncate" title={r.submissionEntity}>{r.submissionEntity}</span>
                            <span className="col-span-1 text-right">
                              {r.active
                                ? <span className="px-1 py-0.5 rounded bg-green-50 text-green-700 text-[10px]">활성</span>
                                : <span className="px-1 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px]">비활성</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
