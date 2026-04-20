"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Search, Filter, ChevronDown, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import MedicationTable, { type ColumnVisibility } from "@/components/MedicationTable";
import ColumnToggles from "@/components/ColumnToggles";
import RequireAuth from "@/components/RequireAuth";
import { useSession } from "next-auth/react";
import type { MedicationItem } from "@/types";
import { hasRole } from "@/lib/roles";

interface CompanyOpt { name: string; count: number }

export default function SearchPage() {
  const { data: session } = useSession();
  const isSalesRep = hasRole(session?.user?.role, "SALES_REP");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MedicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [displayedQuery, setDisplayedQuery] = useState("");
  const [cols, setCols] = useState<ColumnVisibility>({ showRate: true });

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

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim() && selectedCompanies.size === 0) return;
    setLoading(true); setSearched(true); setDisplayedQuery(query);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query);
      if (session?.user?.id) params.set("userId", session.user.id);
      if (selectedCompanies.size > 0) params.set("companies", Array.from(selectedCompanies).join(","));
      params.set("limit", "500");
      const res = await fetch(`/api/medications/search?${params.toString()}`);
      const data = await res.json();
      setResults(data.medications || []); setTotal(data.total || 0);
    } catch { setResults([]); }
    finally { setLoading(false); }
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
      setResults(data.medications || []); setTotal(data.total || 0);
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
    <RequireAuth>
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
    </RequireAuth>
  );
}
