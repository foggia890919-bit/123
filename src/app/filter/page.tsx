"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Building2, Filter, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import MedicationTable from "@/components/MedicationTable";
import RequireAuth from "@/components/RequireAuth";
import { useSession } from "next-auth/react";
import type { MedicationItem } from "@/types";

interface Company {
  name: string;
  isSettlement: boolean;
  count: number;
}

export default function FilterPage() {
  const { data: session } = useSession();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<MedicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  useEffect(() => {
    fetch("/api/medications/companies").then((r) => r.json()).then(setCompanies);
  }, []);

  const filteredCompanies = companies.filter((c) =>
    c.name.toLowerCase().includes(companySearch.toLowerCase())
  );

  function toggleCompany(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function selectAll(companiesList: Company[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      companiesList.forEach((c) => next.add(c.name));
      return next;
    });
  }

  function clearAll() {
    setSelected(new Set());
    setResults([]);
    setSearched(false);
  }

  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (selected.size === 0) return alert("제약사를 1개 이상 선택해주세요.");
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      params.set("q", productSearch.trim() || " ");
      params.set("companies", Array.from(selected).join(","));
      if (session?.user?.id) params.set("userId", session.user.id);
      const res = await fetch(`/api/medications/filter?${params.toString()}`);
      const data = await res.json();
      setResults(data.medications || []);
      setTotal(data.total || 0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [selected, productSearch, session]);

  return (
    <RequireAuth>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Filter className="w-6 h-6 text-blue-600" />제약사 필터링
          </h1>
          <p className="text-gray-500 text-sm mt-1">제약사를 선택하고 해당 회사의 품목을 조회합니다</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* 제약사 목록 */}
          <div className="md:col-span-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">
                  제약사 목록 ({companies.length}개)
                </span>
                {selected.size > 0 && (
                  <button onClick={clearAll} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                    <X className="w-3 h-3" />선택 해제
                  </button>
                )}
              </div>
              <Input
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="제약사 검색..."
                className="h-8 text-xs"
              />
              <div className="flex gap-1">
                <button onClick={() => selectAll(filteredCompanies.filter((c) => c.isSettlement))}
                  className="text-xs text-green-700 bg-green-50 hover:bg-green-100 px-2 py-1 rounded">
                  정산제약사 전체
                </button>
                <button onClick={() => selectAll(filteredCompanies)}
                  className="text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded">
                  전체 선택
                </button>
              </div>
            </div>
            <div className="overflow-y-auto max-h-[500px] divide-y divide-gray-50">
              {filteredCompanies.map((company) => (
                <label key={company.name} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(company.name)}
                    onChange={() => toggleCompany(company.name)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="flex-1 text-sm text-gray-800 truncate">{company.name}</span>
                  {company.isSettlement && (
                    <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded shrink-0">정산</span>
                  )}
                  <span className="text-xs text-gray-400 shrink-0">{company.count}</span>
                </label>
              ))}
              {filteredCompanies.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-8">검색 결과 없음</p>
              )}
            </div>
          </div>

          {/* 검색 및 결과 */}
          <div className="md:col-span-2 space-y-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
              {selected.size > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(selected).map((name) => (
                    <span key={name} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded-full">
                      <Building2 className="w-3 h-3" />{name}
                      <button onClick={() => toggleCompany(name)} className="hover:text-red-500 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
              <form onSubmit={handleSearch} className="flex gap-2">
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="품목명 또는 성분명으로 추가 필터 (선택사항)"
                  className="h-10"
                />
                <Button type="submit" disabled={loading || selected.size === 0}>
                  <Search className="w-4 h-4 mr-1.5" />
                  {selected.size === 0 ? "제약사 선택 필요" : `${selected.size}개 제약사 조회`}
                </Button>
              </form>
            </div>

            {searched && (
              <>
                <p className="text-sm text-gray-500">
                  조회 결과 <span className="font-semibold text-gray-900">{total.toLocaleString()}개</span>
                </p>
                <MedicationTable medications={results} loading={loading} showRate={true} />
              </>
            )}

            {!searched && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400 bg-white rounded-lg border border-gray-200">
                <Filter className="w-8 h-8 mb-2 text-gray-300" />
                <p>왼쪽에서 제약사를 선택하고 조회하세요</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
