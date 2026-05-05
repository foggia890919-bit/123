"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { Building2, Filter, X, Send, FileText, ChevronDown, Search, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import RequireRole from "@/components/RequireRole";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface Company { name: string; isSettlement: boolean; count: number; }
interface ProposalSummary { id: string; title: string; _count?: { items: number }; }
interface MyRequest {
  id: string; clientName: string; bizNumber: string; companyName: string;
  status: string; replyText: string | null; repliedAt: string | null; createdAt: string;
}
interface GlobalClient {
  id: string; clientName: string; bizNumber: string; bizFileName?: string | null;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") return <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded shrink-0">거래가능</span>;
  if (status === "REVIEWING") return <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-1.5 py-0.5 rounded shrink-0">검토중</span>;
  if (status === "PENDING") return <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded shrink-0">요청됨</span>;
  if (status === "REJECTED") return <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded shrink-0">거부됨</span>;
  return null;
}

export default function FilterPage() {
  const { data: session } = useSession();
  const proposalMenuRef = useRef<HTMLDivElement>(null);
  const clientMenuRef = useRef<HTMLDivElement>(null);
  const companyMenuRef = useRef<HTMLDivElement>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 거래처 검색
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<GlobalClient[]>([]);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [clientSearching, setClientSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState<GlobalClient | null>(null);

  const [myClients, setMyClients] = useState<GlobalClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [showProposalMenu, setShowProposalMenu] = useState(false);
  const [companyStatuses, setCompanyStatuses] = useState<Record<string, string>>({});
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);

  useEffect(() => {
    fetch("/api/medications/companies").then((r) => r.json()).then(setCompanies);
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/proposals?userId=${session.user.id}`)
      .then((r) => r.json())
      .then((d) => setProposals(Array.isArray(d) ? d : []));
    fetch(`/api/filter-request/company-status?userId=${session.user.id}`)
      .then((r) => r.json())
      .then(setCompanyStatuses);
    loadMyRequests(session.user.id);
    fetch("/api/user-clients")
      .then((r) => r.json())
      .then((d) => setMyClients(Array.isArray(d) ? d : []));
  }, [session?.user?.id]);

  async function loadMyRequests(uid: string) {
    const res = await fetch(`/api/filter-request?userId=${uid}`);
    const data = await res.json();
    setMyRequests(Array.isArray(data) ? data : []);
  }

  // 거래처 debounced 검색
  useEffect(() => {
    if (!clientQuery.trim()) {
      setClientResults([]);
      setClientSearching(false);
      return;
    }
    setClientSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(clientQuery.trim())}`);
        const data = await res.json();
        setClientResults(Array.isArray(data) ? data : []);
      } finally {
        setClientSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [clientQuery]);

  const displayClients = clientQuery.trim() ? clientResults : myClients;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (proposalMenuRef.current && !proposalMenuRef.current.contains(e.target as Node)) setShowProposalMenu(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (!clientMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (clientMenuRef.current && !clientMenuRef.current.contains(e.target as Node)) setClientMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [clientMenuOpen]);

  useEffect(() => {
    if (!companyMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (companyMenuRef.current && !companyMenuRef.current.contains(e.target as Node)) setCompanyMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [companyMenuOpen]);

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
  }

  const filteredCompanies = companies.filter((c) =>
    !companySearch.trim() || c.name.toLowerCase().includes(companySearch.toLowerCase())
  );

  function toggleCompany(name: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (selected.size === 0) { setError("제약사를 1개 이상 선택해주세요."); return; }
    if (!selectedClient) { setError("거래처를 선택해주세요."); return; }

    setLoading(true);
    const res = await fetch("/api/filter-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session!.user.id,
        userName: session!.user.name || session!.user.email,
        clientName: selectedClient.clientName,
        bizNumber: selectedClient.bizNumber,
        companies: Array.from(selected),
      }),
    });
    if (res.ok) {
      setSuccess(true);
      setSelected(new Set());
      fetch(`/api/filter-request/company-status?userId=${session!.user.id}`)
        .then((r) => r.json()).then(setCompanyStatuses);
      loadMyRequests(session!.user.id);
    } else {
      const d = await res.json();
      setError(d.error || "요청 중 오류가 발생했어요.");
    }
    setLoading(false);
  }

  return (
    <RequireRole minRole="BIZ">
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Filter className="w-6 h-6 text-blue-600" />제약사 필터링
          </h1>
          <p className="text-gray-500 text-sm mt-1">거래처를 검색하여 선택한 후, 해당 거래처로 제약사 거래 가능 여부를 조회 요청합니다.</p>
        </div>

        {success ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center space-y-2">
            <p className="text-green-700 font-semibold">조회 요청이 등록됐어요!</p>
            <p className="text-green-600 text-sm">관리자가 확인 후 회신드릴게요.</p>
            <button onClick={() => setSuccess(false)} className="mt-2 text-sm text-green-700 border border-green-300 px-4 py-2 rounded-lg hover:bg-green-100">
              새 요청하기
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
            <h2 className="font-semibold text-gray-800">거래처 필터링 요청</h2>

            {/* 거래처 선택 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-600">거래처 선택 <span className="text-red-500">*</span></label>
                <Link href="/mypage/clients" className="text-xs text-blue-600 hover:underline">
                  + 거래처 등록하기
                </Link>
              </div>
              <div className="relative" ref={clientMenuRef}>
                <button type="button" onClick={() => setClientMenuOpen((v) => !v)}
                  className="w-full h-10 px-3 border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-left text-sm flex items-center justify-between gap-2">
                  {selectedClient ? (
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
                      <span className="font-medium text-gray-800 truncate">{selectedClient.clientName}</span>
                      <span className="text-gray-400 font-mono text-xs shrink-0">{selectedClient.bizNumber}</span>
                    </span>
                  ) : (
                    <span className="text-gray-400 flex items-center gap-1.5">
                      <Search className="w-3.5 h-3.5" />거래처 검색 및 선택
                    </span>
                  )}
                  <div className="flex items-center gap-1 shrink-0">
                    {selectedClient && (
                      <span
                        onClick={(e) => { e.stopPropagation(); setSelectedClient(null); setClientQuery(""); }}
                        className="p-0.5 text-gray-400 hover:text-gray-600 rounded">
                        <X className="w-3.5 h-3.5" />
                      </span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${clientMenuOpen ? "rotate-180" : ""}`} />
                  </div>
                </button>
                {clientMenuOpen && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
                    <div className="p-2 border-b border-gray-100">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                        <input
                          autoFocus
                          value={clientQuery}
                          onChange={(e) => setClientQuery(e.target.value)}
                          placeholder="거래처명 또는 사업자번호 검색..."
                          className="w-full h-8 pl-8 pr-8 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        {clientSearching && (
                          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-gray-400" />
                        )}
                      </div>
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {displayClients.length === 0 ? (
                        <div className="py-5 px-3 text-center space-y-2">
                          <p className="text-xs text-gray-400">
                            {clientQuery.trim() ? `'${clientQuery}'에 해당하는 거래처가 없어요` : "등록된 거래처가 없어요"}
                          </p>
                          <Link href="/mypage/clients"
                            onClick={() => setClientMenuOpen(false)}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-md transition-colors">
                            <Building2 className="w-3 h-3" />거래처 관리에서 등록하기
                          </Link>
                        </div>
                      ) : (
                        <>
                          {!clientQuery.trim() && (
                            <p className="px-3 py-1.5 text-[11px] text-gray-400 border-b border-gray-50">내 거래처</p>
                          )}
                          {displayClients.map((c) => (
                            <button key={c.id} type="button"
                              onClick={() => { setSelectedClient(c); setClientMenuOpen(false); setClientQuery(""); }}
                              className="w-full text-left px-3 py-2.5 text-xs hover:bg-gray-50 border-b border-gray-50 last:border-0">
                              <p className="font-medium text-gray-800">{c.clientName}</p>
                              <p className="text-gray-400 font-mono">{c.bizNumber}</p>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 제약사 선택 드롭다운 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">제약사 선택 <span className="text-red-500">*</span></label>
              <div className="relative" ref={companyMenuRef}>
                <button type="button" onClick={() => setCompanyMenuOpen((v) => !v)}
                  className="w-full h-10 px-3 border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-left text-sm flex items-center justify-between">
                  {selected.size > 0 ? (
                    <span className="text-gray-800 font-medium">{selected.size}개 선택됨</span>
                  ) : (
                    <span className="text-gray-400 flex items-center gap-1.5"><Search className="w-3.5 h-3.5" />제약사 검색 및 선택</span>
                  )}
                  <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
                </button>
                {companyMenuOpen && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
                    <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-600 shrink-0">
                        정산제약사 {companies.length}개
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
                          <button type="button" onClick={() => setSelected(new Set())}
                            className="text-xs text-red-500 hover:text-red-700 flex items-center gap-0.5 whitespace-nowrap">
                            <X className="w-3 h-3" />전체해제
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="p-2 border-b border-gray-100">
                      <input
                        value={companySearch} onChange={(e) => setCompanySearch(e.target.value)}
                        placeholder="제약사명 검색..."
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                      {filteredCompanies.length === 0 ? (
                        <p className="text-center text-xs text-gray-400 py-6">검색 결과가 없어요.</p>
                      ) : filteredCompanies.map((company) => (
                        <label key={company.name} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 cursor-pointer">
                          <input type="checkbox" checked={selected.has(company.name)} onChange={() => toggleCompany(company.name)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 shrink-0" />
                          <span className="flex-1 text-sm text-gray-800 truncate">{company.name}</span>
                          {companyStatuses[company.name] && <StatusBadge status={companyStatuses[company.name]} />}
                        </label>
                      ))}
                    </div>
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
              <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 rounded-lg">
                {Array.from(selected).map((name) => (
                  <span key={name} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded-full">
                    <Building2 className="w-3 h-3 shrink-0" />{name}
                    {companyStatuses[name] && <StatusBadge status={companyStatuses[name]} />}
                    <button type="button" onClick={() => toggleCompany(name)} className="hover:text-red-500 ml-0.5">×</button>
                  </span>
                ))}
              </div>
            )}

            {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading || selected.size === 0 || !selectedClient}>
              <Send className="w-4 h-4 mr-2" />
              {loading ? "요청 중..." : `${selected.size}개 제약사 조회 등록`}
            </Button>
          </form>
        )}

        {/* 내 요청 내역 */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800 text-sm">내 조회 요청 내역 ({myRequests.length}건)</h2>
            <button type="button" onClick={() => session?.user?.id && loadMyRequests(session.user.id)}
              className="text-xs text-gray-500 hover:text-gray-700">새로고침</button>
          </div>
          {myRequests.length === 0 ? (
            <p className="text-center text-xs text-gray-400 py-8">아직 등록된 요청이 없어요</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
                  <tr className="text-xs text-gray-500 font-semibold">
                    <th className="px-4 py-2.5 text-left">요청일</th>
                    <th className="px-4 py-2.5 text-left">제약사</th>
                    <th className="px-4 py-2.5 text-left">거래처</th>
                    <th className="px-4 py-2.5 text-center">상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {myRequests.map((r) => (
                    <Fragment key={r.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString("ko-KR")}</td>
                        <td className="px-4 py-2.5 text-gray-800 text-xs">{r.companyName}</td>
                        <td className="px-4 py-2.5 text-gray-600 text-xs">{r.clientName}</td>
                        <td className="px-4 py-2.5 text-center"><StatusBadge status={r.status} /></td>
                      </tr>
                      {r.replyText && (
                        <tr className="bg-blue-50/40">
                          <td colSpan={4} className="px-4 py-2">
                            <div className="text-xs text-blue-800">
                              <span className="font-semibold">관리자 회신</span>
                              {r.repliedAt && <span className="text-blue-400 ml-2">({new Date(r.repliedAt).toLocaleString("ko-KR")})</span>}
                            </div>
                            <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">{r.replyText}</p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </RequireRole>
  );
}
