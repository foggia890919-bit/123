"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Building2, Download, X, FileText, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import MedicationTable, { type ColumnVisibility } from "@/components/MedicationTable";
import ColumnToggles from "@/components/ColumnToggles";
import RequireRole from "@/components/RequireRole";
import { useSession } from "next-auth/react";
import type { MedicationItem } from "@/types";
import * as XLSX from "xlsx";

interface Company { name: string; isSettlement: boolean; count: number; hasOutpatient?: boolean; hasInpatient?: boolean; }
interface ProposalSummary { id: string; title: string; _count?: { items: number }; }
type CompanyTab = "전체" | "CSO" | "원내";

function StatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") return <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded shrink-0">거래가능</span>;
  if (status === "REVIEWING") return <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-1.5 py-0.5 rounded shrink-0">검토중</span>;
  if (status === "PENDING") return <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded shrink-0">요청됨</span>;
  if (status === "REJECTED") return <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded shrink-0">거부됨</span>;
  return null;
}

export default function FilterListPage() {
  const { data: session } = useSession();
  const isSalesRep = session?.user?.role === "SALES_REP" || session?.user?.role === "ADMIN";

  const companyMenuRef = useRef<HTMLDivElement>(null);
  const proposalMenuRef = useRef<HTMLDivElement>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [companyTab, setCompanyTab] = useState<CompanyTab>("전체");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [results, setResults] = useState<MedicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [cols, setCols] = useState<ColumnVisibility>({
    showCategoryA: false, showIngredientName: true, showCategoryB: false,
    showRate: false, showCompanyName: true, showBioStatus: true,
    showProductName: true, showPrice: true, showOriginalDrug: true,
    showInsuranceCode: true, showNotes: false, showStock: false,
  });
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [showProposalMenu, setShowProposalMenu] = useState(false);
  const [companyStatuses, setCompanyStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/medications/companies?type=all").then((r) => r.json()).then(setCompanies);
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/proposals?userId=${session.user.id}`)
      .then((r) => r.json())
      .then((d) => setProposals(Array.isArray(d) ? d : []));
    fetch(`/api/filter-request/company-status?userId=${session.user.id}`)
      .then((r) => r.json())
      .then(setCompanyStatuses);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!companyMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (companyMenuRef.current && !companyMenuRef.current.contains(e.target as Node)) setCompanyMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [companyMenuOpen]);

  useEffect(() => {
    if (!showProposalMenu) return;
    function onClick(e: MouseEvent) {
      if (proposalMenuRef.current && !proposalMenuRef.current.contains(e.target as Node)) setShowProposalMenu(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showProposalMenu]);

  async function loadFromProposal(proposalId: string) {
    setShowProposalMenu(false);
    setCompanyMenuOpen(false);
    const res = await fetch(`/api/proposals/${proposalId}`);
    const data = await res.json();
    const names = new Set<string>(
      (data.items || [])
        .map((item: { altMedication?: { companyName?: string } }) => item.altMedication?.companyName)
        .filter(Boolean)
    );
    setSelected(names);
    setSearched(false);
    setResults([]);
  }

  const tabCompanies = companies.filter((c) => {
    if (companyTab === "CSO") return c.hasOutpatient;
    if (companyTab === "원내") return c.hasInpatient;
    return true;
  });

  const filteredCompanies = tabCompanies.filter((c) =>
    !companySearch.trim() || c.name.toLowerCase().includes(companySearch.toLowerCase())
  );

  function toggleCompany(name: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }

  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (selected.size === 0) return alert("제약사를 1개 이상 선택해주세요.");
    setLoading(true); setSearched(true); setPage(1);
    try {
      const params = new URLSearchParams();
      params.set("q", productSearch.trim() || " ");
      params.set("companies", Array.from(selected).join(","));
      if (session?.user?.id) params.set("userId", session.user.id);
      if (companyTab === "CSO") params.set("settlementType", "원외");
      else if (companyTab === "원내") params.set("settlementType", "원내");
      params.set("limit", "9999");
      const res = await fetch(`/api/medications/filter?${params.toString()}`);
      const data = await res.json();
      setResults(data.medications || []); setTotal(data.total || 0);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, [selected, productSearch, session, companyTab]);

  const [downloading, setDownloading] = useState(false);

  async function exportExcel() {
    if (selected.size === 0) return;
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      params.set("q", productSearch.trim() || " ");
      params.set("companies", Array.from(selected).join(","));
      if (session?.user?.id) params.set("userId", session.user.id);
      if (companyTab === "CSO") params.set("settlementType", "원외");
      else if (companyTab === "원내") params.set("settlementType", "원내");
      params.set("limit", "9999");
      const res = await fetch(`/api/medications/filter?${params.toString()}`);
      const data = await res.json();
      const all: MedicationItem[] = data.medications || [];

      const rows = all.map((m) => ({
        ...(cols.showCategoryA ? { "분류(A)": m.categoryA || "" } : {}),
        ...(cols.showIngredientName ? { 성분명: m.ingredientName } : {}),
        ...(cols.showCategoryB ? { "ATC코드": m.ingredientCode || "" } : {}),
        ...(isSalesRep && cols.showRate ? { 수수료율: m.commissionRate != null ? `${m.commissionRate}%` : "" } : {}),
        ...(cols.showCompanyName ? { 제약사명: m.companyName } : {}),
        ...(cols.showBioStatus ? { "생동/생산": m.bioStatus || "" } : {}),
        ...(cols.showProductName ? { 품목명: m.productName } : {}),
        ...(cols.showPrice ? { 약가: m.price || "" } : {}),
        ...(cols.showOriginalDrug ? { "오리지날/대조약": m.originalDrug || "" } : {}),
        ...(cols.showInsuranceCode ? { 보험코드: m.insuranceCode || "" } : {}),
        ...(cols.showNotes ? { 특이사항: m.notes || "" } : {}),
        ...(cols.showStock ? { 재고: m.stock != null ? m.stock : "" } : {}),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "제약사리스트");
      XLSX.writeFile(wb, `제약사별리스트_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <RequireRole minRole="SALES_REP">
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Download className="w-6 h-6 text-blue-600" />제약사별 리스트 다운
          </h1>
          <p className="text-gray-500 text-sm mt-1">제약사를 선택해서 품목 리스트를 조회하고 엑셀로 다운로드하세요</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          {/* 제약사 선택 드롭다운 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">제약사 선택</label>
            <div className="relative" ref={companyMenuRef}>
              <button type="button" onClick={() => setCompanyMenuOpen((v) => !v)}
                className="w-full h-10 px-3 border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-left text-sm flex items-center justify-between">
                {selected.size > 0 ? (
                  <span className="font-medium text-gray-800">{selected.size}개 제약사 선택됨</span>
                ) : (
                  <span className="text-gray-400 flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5" />제약사 검색 및 선택
                  </span>
                )}
                <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
              </button>

              {companyMenuOpen && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
                  {/* 원외/원내/전체 탭 */}
                  <div className="px-3 pt-2.5 pb-2 border-b border-gray-100">
                    <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5 text-xs mb-2">
                      {(["전체", "CSO", "원내"] as CompanyTab[]).map((tab) => {
                        const count = tab === "전체" ? companies.length
                          : tab === "CSO" ? companies.filter((c) => c.hasOutpatient).length
                          : companies.filter((c) => c.hasInpatient).length;
                        return (
                          <button key={tab} type="button"
                            onClick={() => setCompanyTab(tab)}
                            className={`flex-1 py-1 rounded-md font-medium transition-colors ${companyTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                            {tab} ({count})
                          </button>
                        );
                      })}
                    </div>
                    {/* 헤더: 카운트 + 제안서 + 해제 */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-600 shrink-0">
                        {filteredCompanies.length}개
                        {selected.size > 0 && <span className="text-blue-600 ml-1">({selected.size}개 선택)</span>}
                      </span>
                      <div className="flex items-center gap-1.5 ml-auto">
                        <div className="relative" ref={proposalMenuRef}>
                          <button type="button" onClick={() => setShowProposalMenu((v) => !v)}
                            className="flex items-center gap-1 text-xs text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 px-2 py-1 rounded transition-colors whitespace-nowrap">
                            <FileText className="w-3 h-3" />제안서
                            <ChevronDown className="w-3 h-3" />
                          </button>
                          {showProposalMenu && (
                            <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[160px] max-h-48 overflow-y-auto">
                              {proposals.length === 0 ? (
                                <p className="text-xs text-gray-400 px-3 py-2">제안서가 없어요</p>
                              ) : proposals.map((p) => (
                                <button key={p.id} onClick={() => loadFromProposal(p.id)}
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-b border-gray-50 last:border-0">
                                  <p className="font-medium text-gray-800 truncate">{p.title}</p>
                                  <p className="text-gray-400">{p._count?.items ?? 0}개 품목</p>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {selected.size > 0 && (
                          <button type="button" onClick={() => { setSelected(new Set()); setResults([]); setSearched(false); }}
                            className="text-xs text-red-500 hover:text-red-700 flex items-center gap-0.5 whitespace-nowrap">
                            <X className="w-3 h-3" />전체해제
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 검색 */}
                  <div className="p-2 border-b border-gray-100">
                    <input value={companySearch} onChange={(e) => setCompanySearch(e.target.value)}
                      placeholder="제약사명 검색..."
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>

                  {/* 목록 */}
                  <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
                    {filteredCompanies.length === 0 ? (
                      <p className="text-center text-xs text-gray-400 py-6">검색 결과가 없어요.</p>
                    ) : filteredCompanies.map((company) => (
                      <label key={company.name} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={selected.has(company.name)} onChange={() => toggleCompany(company.name)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 shrink-0" />
                        <span className="flex-1 text-sm text-gray-800 truncate">{company.name}</span>
                        <span className="text-xs text-gray-400 shrink-0">{company.count}</span>
                        {companyStatuses[company.name] && <StatusBadge status={companyStatuses[company.name]} />}
                      </label>
                    ))}
                  </div>

                  {/* 완료 버튼 */}
                  <div className="border-t border-gray-100 p-2">
                    <button type="button" onClick={() => setCompanyMenuOpen(false)}
                      className="w-full py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors">
                      완료{selected.size > 0 ? ` (${selected.size}개 선택)` : ""}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 선택된 제약사 칩 */}
          {selected.size > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              {Array.from(selected).map((name) => (
                <span key={name} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded-full">
                  <Building2 className="w-3 h-3 shrink-0" />{name}
                  {companyStatuses[name] && <StatusBadge status={companyStatuses[name]} />}
                  <button type="button" onClick={() => toggleCompany(name)} className="hover:text-red-500 ml-0.5">×</button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => { setSelected(new Set()); setResults([]); setSearched(false); }}
                className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-200 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-full transition-colors whitespace-nowrap"
              >
                <X className="w-3 h-3" />전체 해제
              </button>
            </div>
          )}

          {/* 품목명 필터 + 조회 버튼 */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
              placeholder="품목명 또는 성분명으로 추가 필터 (선택사항)" className="h-10" />
            <Button type="submit" disabled={loading || selected.size === 0} className="shrink-0">
              <Search className="w-4 h-4 mr-1.5" />
              {selected.size === 0 ? "제약사 선택 필요" : `${selected.size}개 조회`}
            </Button>
          </form>
        </div>

        {searched && (() => {
          const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
          const pageItems = results.slice((page - 1) * pageSize, page * pageSize);
          const WINDOW = 10;
          const pageNums: (number | "…")[] = [];
          if (totalPages <= WINDOW) {
            for (let i = 1; i <= totalPages; i++) pageNums.push(i);
          } else {
            const half = Math.floor(WINDOW / 2);
            let start = Math.max(1, page - half);
            let end = start + WINDOW - 1;
            if (end > totalPages) { end = totalPages; start = Math.max(1, end - WINDOW + 1); }
            if (start > 1) { pageNums.push(1); if (start > 2) pageNums.push("…"); }
            for (let i = start; i <= end; i++) pageNums.push(i);
            if (end < totalPages) { if (end < totalPages - 1) pageNums.push("…"); pageNums.push(totalPages); }
          }
          return (
            <>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <p className="text-sm text-gray-500">
                    조회 결과 <span className="font-semibold text-gray-900">{results.length.toLocaleString()}개</span>
                  </p>
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                    className="text-xs border border-gray-300 rounded px-2 py-1 text-gray-600 bg-white"
                  >
                    {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}개씩</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Button size="sm" variant="outline" onClick={exportExcel} disabled={results.length === 0 || downloading}>
                    <Download className="w-4 h-4 mr-1.5" />{downloading ? "다운로드 중…" : "엑셀 다운"}
                  </Button>
                </div>
              </div>
              <MedicationTable medications={pageItems} loading={loading} {...cols} showRate={isSalesRep ? cols.showRate : false} userId={session?.user?.id} />
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1 pt-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-2.5 py-1.5 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >이전</button>
                  {pageNums.map((n, i) =>
                    n === "…" ? (
                      <span key={`ellipsis-${i}`} className="px-1.5 text-xs text-gray-400">…</span>
                    ) : (
                      <button
                        key={n}
                        onClick={() => setPage(n as number)}
                        className={`px-2.5 py-1.5 text-xs rounded border ${page === n ? "bg-gray-900 text-white border-gray-900 font-semibold" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
                      >{n}</button>
                    )
                  )}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-2.5 py-1.5 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >다음</button>
                </div>
              )}
            </>
          );
        })()}

        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500">출력 항목 선택</p>
          <ColumnToggles cols={cols} setCols={setCols} isSalesRep={isSalesRep} />
          {!searched && (
            <div className="flex items-center gap-2 pt-2 text-gray-400 text-sm">
              <Download className="w-4 h-4 text-gray-300 shrink-0" />
              위에서 제약사를 선택하고 조회하세요
            </div>
          )}
        </div>
      </div>
    </RequireRole>
  );
}
