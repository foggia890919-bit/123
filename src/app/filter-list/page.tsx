"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Building2, Download, X, FileText, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import MedicationTable, { type ColumnVisibility } from "@/components/MedicationTable";
import ColumnToggles from "@/components/ColumnToggles";
import RequireAuth from "@/components/RequireAuth";
import { useSession } from "next-auth/react";
import type { MedicationItem } from "@/types";
import * as XLSX from "xlsx";

interface Company { name: string; isSettlement: boolean; count: number; }
interface ProposalSummary { id: string; title: string; _count?: { items: number }; }
type CompanyTab = "전체" | "원외" | "원내";

function StatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") return <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded shrink-0">거래가능</span>;
  if (status === "REVIEWING") return <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-1.5 py-0.5 rounded shrink-0">검토중</span>;
  if (status === "PENDING") return <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded shrink-0">요청됨</span>;
  if (status === "REJECTED") return <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded shrink-0">거부됨</span>;
  return null;
}

export default function FilterListPage() {
  const { data: session } = useSession();
  const isSalesRep = session?.user?.role === "SALES_REP";
  const proposalMenuRef = useRef<HTMLDivElement>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<MedicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [cols, setCols] = useState<ColumnVisibility>({
    showCategoryB: true, showBioStatus: true, showOriginalDrug: true,
    showInsuranceCode: true, showNotes: true, showRate: true,
  });
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [showProposalMenu, setShowProposalMenu] = useState(false);
  const [companyStatuses, setCompanyStatuses] = useState<Record<string, string>>({});
  const [companyTab, setCompanyTab] = useState<CompanyTab>("전체");

  useEffect(() => {
    fetch("/api/medications/companies?filter=all").then((r) => r.json()).then(setCompanies);
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
    if (!showProposalMenu) return;
    function handleClick(e: MouseEvent) {
      if (proposalMenuRef.current && !proposalMenuRef.current.contains(e.target as Node)) {
        setShowProposalMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showProposalMenu]);

  async function loadFromProposal(proposalId: string) {
    setShowProposalMenu(false);
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
    if (companyTab === "원외") return c.isSettlement;
    if (companyTab === "원내") return !c.isSettlement;
    return true;
  });

  const filteredCompanies = tabCompanies.filter((c) =>
    c.name.toLowerCase().includes(companySearch.toLowerCase())
  );

  function toggleCompany(name: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }

  const handleSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (selected.size === 0) return alert("제약사를 1개 이상 선택해주세요.");
    setLoading(true); setSearched(true);
    try {
      const params = new URLSearchParams();
      params.set("q", productSearch.trim() || " ");
      params.set("companies", Array.from(selected).join(","));
      if (session?.user?.id) params.set("userId", session.user.id);
      const res = await fetch(`/api/medications/filter?${params.toString()}`);
      const data = await res.json();
      setResults(data.medications || []); setTotal(data.total || 0);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, [selected, productSearch, session]);

  function exportExcel() {
    const rows = results.map((m) => ({
      분류A: m.categoryA || "", 성분명: m.ingredientName, 분류B: m.categoryB || "",
      수수료율: m.commissionRate != null ? `${m.commissionRate}%` : "",
      제약사명: m.companyName, "생동/생산": m.bioStatus || "", 품목명: m.productName,
      약가: m.price || "", "오리지날/대조약": m.originalDrug || "",
      보험코드: m.insuranceCode || "", 특이사항: m.notes || "",
      ...(isSalesRep ? { 추가수수료: m.additionalRate != null ? `${m.additionalRate}%` : "" } : {}),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "제약사리스트");
    XLSX.writeFile(wb, `제약사별리스트_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <RequireAuth>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Download className="w-6 h-6 text-blue-600" />제약사별 리스트 다운
          </h1>
          <p className="text-gray-500 text-sm mt-1">제약사를 선택해서 품목 리스트를 조회하고 엑셀로 다운로드하세요</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="md:col-span-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 space-y-2">
              {/* 원외/원내/전체 탭 */}
              <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5 text-xs">
                {(["전체", "원외", "원내"] as CompanyTab[]).map((tab) => {
                  const count = tab === "전체" ? companies.length : tab === "원외" ? companies.filter(c => c.isSettlement).length : companies.filter(c => !c.isSettlement).length;
                  return (
                    <button key={tab} onClick={() => setCompanyTab(tab)}
                      className={`flex-1 py-1 rounded-md font-medium transition-colors ${companyTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                      {tab} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-800 shrink-0">{filteredCompanies.length}개 제약사</span>
                <div className="flex items-center gap-1.5 ml-auto">
                  {/* 제안서 불러오기 */}
                  <div className="relative" ref={proposalMenuRef}>
                    <button
                      type="button"
                      onClick={() => setShowProposalMenu((v) => !v)}
                      className="flex items-center gap-1 text-xs text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 px-2 py-1 rounded transition-colors whitespace-nowrap"
                    >
                      <FileText className="w-3 h-3" />제안서 불러오기
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {showProposalMenu && (
                      <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[160px] max-h-48 overflow-y-auto">
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
                    <button onClick={() => { setSelected(new Set()); setResults([]); setSearched(false); }}
                      className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                      <X className="w-3 h-3" />해제
                    </button>
                  )}
                </div>
              </div>
              <Input value={companySearch} onChange={(e) => setCompanySearch(e.target.value)} placeholder="제약사 검색..." className="h-8 text-xs" />
            </div>
            <div className="overflow-y-auto max-h-[500px] divide-y divide-gray-50">
              {filteredCompanies.map((company) => (
                <label key={company.name} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={selected.has(company.name)} onChange={() => toggleCompany(company.name)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 shrink-0" />
                  <span className="flex-1 text-sm text-gray-800 truncate">{company.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">{company.count}</span>
                  {companyStatuses[company.name] && <StatusBadge status={companyStatuses[company.name]} />}
                </label>
              ))}
            </div>
          </div>

          <div className="md:col-span-2 space-y-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
              {selected.size > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">선택된 제약사 ({selected.size}개)</span>
                    <button type="button" onClick={() => { setSelected(new Set()); setResults([]); setSearched(false); }}
                      className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                      <X className="w-3 h-3" />전체 제거
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(selected).map((name) => (
                      <span key={name} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded-full">
                        <Building2 className="w-3 h-3" />{name}
                        {companyStatuses[name] && <StatusBadge status={companyStatuses[name]} />}
                        <button onClick={() => toggleCompany(name)} className="hover:text-red-500 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <form onSubmit={handleSearch} className="flex gap-2">
                <Input value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="품목명 또는 성분명으로 추가 필터 (선택사항)" className="h-10" />
                <Button type="submit" disabled={loading || selected.size === 0}>
                  <Search className="w-4 h-4 mr-1.5" />
                  {selected.size === 0 ? "제약사 선택 필요" : `${selected.size}개 제약사 조회`}
                </Button>
              </form>
            </div>

            {searched && (
              <>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <p className="text-sm text-gray-500">조회 결과 <span className="font-semibold text-gray-900">{total.toLocaleString()}개</span></p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <ColumnToggles cols={cols} setCols={setCols} isSalesRep={isSalesRep} />
                    <Button size="sm" variant="outline" onClick={exportExcel} disabled={results.length === 0}>
                      <Download className="w-4 h-4 mr-1.5" />엑셀 다운
                    </Button>
                  </div>
                </div>
                <MedicationTable medications={results} loading={loading} {...cols} showRate={isSalesRep ? cols.showRate : false} userId={session?.user?.id} />
              </>
            )}

            {!searched && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400 bg-white rounded-lg border border-gray-200">
                <Download className="w-8 h-8 mb-2 text-gray-300" />
                <p>왼쪽에서 제약사를 선택하고 조회하세요</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
