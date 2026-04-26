"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Search, Filter, ChevronDown, X, Clock, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import MedicationTable, { type ColumnVisibility } from "@/components/MedicationTable";
import ColumnToggles from "@/components/ColumnToggles";
import GuestGateModal from "@/components/GuestGateModal";
import { useSession } from "next-auth/react";
import type { MedicationItem } from "@/types";
import { hasRole } from "@/lib/roles";
import { useGuestLimit } from "@/hooks/useGuestLimit";

interface CompanyOpt { name: string; count: number }
interface SearchHistoryItem {
  id: string;
  query: string;
  companies: string[];
  resultCount: number;
  searchedAt: string;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function SearchPage() {
  const { data: session } = useSession();
  const isSalesRep = hasRole(session?.user?.role, "SALES_REP");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MedicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [displayedQuery, setDisplayedQuery] = useState("");
  const [showGate, setShowGate] = useState(false);
  const [cols, setCols] = useState<ColumnVisibility>({
    showIngredientName: true,
    showBioStatus: true,
    showOriginalDrug: true,
    showInsuranceCode: true,
    showPrice: true,
    showRate: true,
    showCategoryA: false,
    showCategoryB: false,
    showNotes: false,
    showStock: true,
    showCompanyName: false,
  });

  const { remaining, isBlocked, consume } = useGuestLimit(!!session);

  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("med_search_history");
      if (saved) setSearchHistory(JSON.parse(saved));
    } catch {}
  }, []);

  function saveHistory(q: string, companies: Set<string>, count: number) {
    setSearchHistory((prev) => {
      const entry: SearchHistoryItem = {
        id: Date.now().toString(),
        query: q,
        companies: Array.from(companies),
        resultCount: count,
        searchedAt: new Date().toISOString(),
      };
      const filtered = prev.filter(
        (h) => !(h.query === q && JSON.stringify([...h.companies].sort()) === JSON.stringify([...companies].sort()))
      );
      const next = [entry, ...filtered].slice(0, 20);
      try { localStorage.setItem("med_search_history", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function removeHistory(id: string) {
    setSearchHistory((prev) => {
      const next = prev.filter((h) => h.id !== id);
      try { localStorage.setItem("med_search_history", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function clearHistory() {
    setSearchHistory([]);
    try { localStorage.removeItem("med_search_history"); } catch {}
  }

  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(new Set());
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [companyQuery, setCompanyQuery] = useState("");
  const companyMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/medications/companies?type=all")
      .then((r) => r.json())
      .then((data: { name: string; count: number }[]) => setCompanies(data.map((c) => ({ name: c.name, count: c.count }))))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (!companyMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (companyMenuRef.current && !companyMenuRef.current.contains(e.target as Node)) setCompanyMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [companyMenuOpen]);

  const filteredCompanies = useMemo(() => {
    if (!companyQuery.trim()) return companies;
    const k = companyQuery.toLowerCase().trim();
    return companies.filter((c) => c.name.toLowerCase().includes(k));
  }, [companies, companyQuery]);

  function toggleCompany(name: string) {
    setSelectedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }
  function clearCompanies() { setSelectedCompanies(new Set()); }

  async function runSearch(q: string, cos: Set<string>) {
    if (!q.trim() && cos.size === 0) return;
    if (!consume()) { setShowGate(true); return; }
    setLoading(true); setSearched(true); setDisplayedQuery(q);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q);
      if (session?.user?.id) params.set("userId", session.user.id);
      if (cos.size > 0) params.set("companies", Array.from(cos).join(","));
      params.set("limit", "500");
      const res = await fetch(`/api/medications/search?${params.toString()}`);
      const data = await res.json();
      const count = data.total || 0;
      setResults(data.medications || []); setTotal(count);
      saveHistory(q, cos, count);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    await runSearch(query, selectedCompanies);
  }

  async function applyHistory(item: SearchHistoryItem) {
    const cos = new Set(item.companies);
    setQuery(item.query);
    setSelectedCompanies(cos);
    await runSearch(item.query, cos);
  }

  async function refetchWithCompanies(nextSet: Set<string>) {
    if (!searched) return;
    if (!query.trim() && nextSet.size === 0) { setResults([]); setTotal(0); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query);
      if (session?.user?.id) params.set("userId", session.user.id);
      if (nextSet.size > 0) params.set("companies", Array.from(nextSet).join(","));
      params.set("limit", "500");
      const res = await fetch(`/api/medications/search?${params.toString()}`);
      const data = await res.json();
      const count = data.total || 0;
      setResults(data.medications || []); setTotal(count);
      saveHistory(query, nextSet, count);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }

  function removeChip(name: string) {
    const next = new Set(selectedCompanies);
    next.delete(name);
    setSelectedCompanies(next);
    refetchWithCompanies(next);
  }

  return (
    <>
      {showGate && <GuestGateModal onClose={() => setShowGate(false)} />}
      <div className="space-y-5">
        {!searched && (
          <div className="text-center space-y-2 py-10">
            <h1 className="text-3xl font-bold text-gray-900">대체의약품 검색</h1>
            <p className="text-gray-400">제품명 또는 성분명으로 검색하세요</p>
          </div>
        )}
        {searched && (
          <div className="text-sm text-gray-500">
            통합 검색 &gt; <span className="font-semibold text-gray-800">{displayedQuery || "전체"}</span>
          </div>
        )}

        {!session && (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex-wrap">
            <span className="font-semibold">비로그인 무료 검색</span>
            <span className="flex gap-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <span
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${i < (3 - remaining) ? "bg-amber-500" : "bg-amber-200"}`}
                />
              ))}
            </span>
            <span className={isBlocked ? "text-red-500 font-semibold" : "text-amber-600"}>
              {isBlocked ? "횟수 소진" : `${remaining}회 남음`}
            </span>
            <a href="/register" className="ml-auto underline text-amber-700 hover:text-amber-900 whitespace-nowrap">가입하면 무제한 →</a>
          </div>
        )}

        <form onSubmit={handleSearch} className="flex gap-2 max-w-2xl items-start">
          <Input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 리피토, atorvastatin, 아스피린..." className="h-11 text-base" />
          <div ref={companyMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setCompanyMenuOpen((v) => !v)}
              className="h-11 text-sm border border-gray-300 bg-white hover:bg-gray-50 rounded-md px-3 inline-flex items-center gap-1.5 text-gray-700 whitespace-nowrap"
            >
              <Filter className="w-4 h-4" />
              제약사
              {selectedCompanies.size > 0 && (
                <span className="bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 text-[10px] font-semibold">{selectedCompanies.size}</span>
              )}
              <ChevronDown className="w-3 h-3" />
            </button>
            {companyMenuOpen && (
              <div className="absolute z-20 mt-1 right-0 w-80 bg-white border border-gray-200 rounded-lg shadow-lg">
                <div className="p-2 border-b flex gap-1">
                  <button type="button" onClick={() => setSelectedCompanies((prev) => {
                    const next = new Set(prev);
                    filteredCompanies.forEach((c) => next.add(c.name));
                    return next;
                  })}
                    className="flex-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-2 py-1">
                    {companyQuery.trim() ? "검색결과 전체선택" : "전체선택"}
                  </button>
                  <button type="button" onClick={() => setSelectedCompanies((prev) => {
                    const next = new Set(prev);
                    filteredCompanies.forEach((c) => next.delete(c.name));
                    return next;
                  })}
                    className="flex-1 text-xs bg-gray-50 hover:bg-gray-100 text-gray-700 rounded px-2 py-1">
                    {companyQuery.trim() ? "검색결과 해제" : "전체해제"}
                  </button>
                </div>
                <div className="p-2 border-b">
                  <input
                    type="text"
                    value={companyQuery}
                    onChange={(e) => setCompanyQuery(e.target.value)}
                    placeholder="제약사 검색..."
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto py-1">
                  {filteredCompanies.length === 0 ? (
                    <p className="text-center text-xs text-gray-400 py-6">제약사가 없어요.</p>
                  ) : (
                    filteredCompanies.map((c) => (
                      <label key={c.name} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={selectedCompanies.has(c.name)}
                          onChange={() => toggleCompany(c.name)}
                          className="w-3.5 h-3.5 rounded border-gray-300"
                        />
                        <span className="flex-1 text-gray-700 truncate">{c.name}</span>
                        <span className="text-gray-400">{c.count}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <Button type="submit" size="lg" disabled={loading} className="shrink-0 whitespace-nowrap"><Search className="w-4 h-4 mr-2" />검색</Button>
        </form>
        {selectedCompanies.size > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {Array.from(selectedCompanies).map((name) => (
              <span key={name} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-1 inline-flex items-center gap-1">
                {name}
                <button type="button" onClick={() => removeChip(name)} className="text-blue-400 hover:text-blue-700">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <button type="button" onClick={() => { clearCompanies(); refetchWithCompanies(new Set()); }}
              className="text-xs text-gray-500 hover:text-gray-700 underline ml-1">모두 지우기</button>
          </div>
        )}

        {/* 검색 히스토리 */}
        {searchHistory.length > 0 && (
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-1.5">
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700"
              >
                <Clock className="w-3.5 h-3.5" />
                최근 검색
                <span className="text-gray-400 font-normal">({searchHistory.length})</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${historyOpen ? "" : "-rotate-90"}`} />
              </button>
              {historyOpen && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> 전체 삭제
                </button>
              )}
            </div>
            {historyOpen && (
              <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {searchHistory.map((item) => (
                  <div
                    key={item.id}
                    className="group flex items-center gap-2 bg-white rounded-lg border border-gray-100 px-3 py-2 hover:border-blue-200 hover:bg-blue-50/30 transition-colors"
                  >
                    <Search className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left"
                      onClick={() => applyHistory(item)}
                    >
                      <span className="text-sm font-medium text-gray-800 truncate block">
                        {item.query || <span className="text-gray-400 font-normal">(검색어 없음)</span>}
                      </span>
                      {item.companies.length > 0 && (
                        <span className="text-xs text-gray-400 truncate block">
                          {item.companies.slice(0, 3).join(" · ")}
                          {item.companies.length > 3 && ` 외 ${item.companies.length - 3}개`}
                        </span>
                      )}
                    </button>
                    <span className="text-xs text-gray-400 shrink-0 tabular-nums">
                      {item.resultCount.toLocaleString()}건
                    </span>
                    <span className="text-xs text-gray-300 shrink-0">
                      {formatRelativeTime(item.searchedAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeHistory(item.id)}
                      className="text-gray-200 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="삭제"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {searched && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm text-gray-500">검색 결과 <span className="font-semibold text-gray-900">{total.toLocaleString()}개</span></p>
              <ColumnToggles cols={cols} setCols={setCols} isSalesRep={isSalesRep} />
            </div>
            <MedicationTable medications={results} loading={loading} {...cols} showRate={isSalesRep ? cols.showRate : false} userId={session?.user?.id} />
          </>
        )}
      </div>
    </>
  );
}
