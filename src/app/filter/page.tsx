"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { Building2, Filter, X, Upload, Send, FileText, ChevronDown, Plus, Trash2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import RequireAuth from "@/components/RequireAuth";
import { useSession } from "next-auth/react";

interface Company { name: string; isSettlement: boolean; count: number; }
interface ProposalSummary { id: string; title: string; _count?: { items: number }; }
interface MyRequest {
  id: string; clientName: string; bizNumber: string; companyName: string;
  status: string; replyText: string | null; repliedAt: string | null; createdAt: string;
}
interface UserClient {
  id: string; clientName: string; bizNumber: string;
  bizFileName: string | null; createdAt: string;
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
  const fileRef = useRef<HTMLInputElement>(null);
  const proposalMenuRef = useRef<HTMLDivElement>(null);
  const clientMenuRef = useRef<HTMLDivElement>(null);
  const companyMenuRef = useRef<HTMLDivElement>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 거래처 등록 폼
  const [regClientName, setRegClientName] = useState("");
  const [regBizNumber, setRegBizNumber] = useState("");
  const [regFile, setRegFile] = useState<File | null>(null);
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState("");

  // 거래처 필터링 요청
  const [userClients, setUserClients] = useState<UserClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState("");

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

  async function loadMyRequests(uid: string) {
    const res = await fetch(`/api/filter-request?userId=${uid}`);
    const data = await res.json();
    setMyRequests(Array.isArray(data) ? data : []);
  }

  async function loadUserClients(uid: string) {
    const res = await fetch(`/api/user-clients?userId=${uid}`);
    const data = await res.json();
    setUserClients(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/proposals?userId=${session.user.id}`)
      .then((r) => r.json())
      .then((d) => setProposals(Array.isArray(d) ? d : []));
    fetch(`/api/filter-request/company-status?userId=${session.user.id}`)
      .then((r) => r.json())
      .then(setCompanyStatuses);
    loadMyRequests(session.user.id);
    loadUserClients(session.user.id);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!showProposalMenu) return;
    function onClick(e: MouseEvent) {
      if (proposalMenuRef.current && !proposalMenuRef.current.contains(e.target as Node)) setShowProposalMenu(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showProposalMenu]);

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
  const filteredClients = userClients.filter((c) =>
    !clientQuery.trim() || c.clientName.toLowerCase().includes(clientQuery.toLowerCase()) || c.bizNumber.includes(clientQuery)
  );
  const selectedClient = userClients.find((c) => c.id === selectedClientId) || null;

  function toggleCompany(name: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }

  function formatBizNumber(v: string) {
    const d = v.replace(/\D/g, "");
    if (d.length <= 3) return d;
    if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5, 10)}`;
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegError("");
    if (!regClientName || !regBizNumber) { setRegError("거래처명과 사업자번호를 입력해주세요."); return; }
    setRegistering(true);
    let bizDocument: string | null = null, bizFileName: string | null = null;
    if (regFile) {
      bizDocument = await new Promise<string>((res) => {
        const reader = new FileReader();
        reader.readAsDataURL(regFile);
        reader.onload = () => res(reader.result as string);
      });
      bizFileName = regFile.name;
    }
    const res = await fetch("/api/user-clients", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session!.user.id,
        clientName: regClientName, bizNumber: regBizNumber, bizDocument, bizFileName,
      }),
    });
    if (res.ok) {
      const created: UserClient = await res.json();
      setRegClientName(""); setRegBizNumber(""); setRegFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await loadUserClients(session!.user.id);
      setSelectedClientId(created.id);
    } else {
      const d = await res.json();
      setRegError(d.error || "등록 중 오류가 발생했어요.");
    }
    setRegistering(false);
  }

  async function handleDeleteClient(id: string) {
    if (!confirm("이 거래처를 삭제할까요?")) return;
    await fetch(`/api/user-clients?id=${id}`, { method: "DELETE" });
    if (selectedClientId === id) setSelectedClientId("");
    await loadUserClients(session!.user.id);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (selected.size === 0) { setError("제약사를 1개 이상 선택해주세요."); return; }
    if (!selectedClient) { setError("거래처를 선택해주세요."); return; }

    setLoading(true);
    const res = await fetch("/api/filter-request", {
      method: "POST", headers: { "Content-Type": "application/json" },
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
    <RequireAuth>
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Filter className="w-6 h-6 text-blue-600" />제약사 필터링
          </h1>
          <p className="text-gray-500 text-sm mt-1">거래처를 먼저 등록한 뒤, 해당 거래처로 제약사 거래 가능 여부를 조회 요청합니다.</p>
        </div>

        {/* 거래처 등록 */}
        <form onSubmit={handleRegister} className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">거래처 등록</h2>
            <span className="text-xs text-gray-400">등록된 거래처 {userClients.length}개</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">거래처명 <span className="text-red-500">*</span></label>
              <Input value={regClientName} onChange={(e) => setRegClientName(e.target.value)} placeholder="거래처 상호명" className="h-9" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">사업자번호 <span className="text-red-500">*</span></label>
              <Input value={regBizNumber} onChange={(e) => setRegBizNumber(formatBizNumber(e.target.value))} placeholder="000-00-00000" maxLength={12} className="h-9" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">사업자등록증 <span className="text-gray-400 font-normal">(선택)</span></label>
            <div onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${regFile ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400"}`}>
              <Upload className="w-4 h-4 text-gray-400 mx-auto mb-1" />
              <p className="text-xs text-gray-500">{regFile ? <span className="font-medium text-gray-800">{regFile.name}</span> : "클릭해서 파일 첨부"}</p>
              <p className="text-[10px] text-gray-400">JPG, PNG, PDF 지원</p>
              <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                onChange={(e) => setRegFile(e.target.files?.[0] || null)} />
            </div>
          </div>
          {regError && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{regError}</p>}
          <Button type="submit" disabled={registering} className="w-full">
            <Plus className="w-4 h-4 mr-1.5" />{registering ? "등록 중..." : "거래처 등록"}
          </Button>
        </form>

        {/* 거래처 필터링 요청 */}
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

            {/* 거래처 선택 드롭다운 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">거래처 선택 <span className="text-red-500">*</span></label>
              <div className="relative" ref={clientMenuRef}>
                <button type="button" onClick={() => setClientMenuOpen((v) => !v)}
                  className="w-full h-10 px-3 border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-left text-sm flex items-center justify-between">
                  {selectedClient ? (
                    <span className="text-gray-800"><span className="font-medium">{selectedClient.clientName}</span> <span className="text-gray-400">· {selectedClient.bizNumber}</span></span>
                  ) : (
                    <span className="text-gray-400">거래처를 선택해주세요</span>
                  )}
                  <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
                </button>
                {clientMenuOpen && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
                    <div className="p-2 border-b">
                      <input
                        value={clientQuery} onChange={(e) => setClientQuery(e.target.value)}
                        placeholder="거래처명 / 사업자번호로 검색..."
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {filteredClients.length === 0 ? (
                        <p className="text-center text-xs text-gray-400 py-6">
                          {userClients.length === 0 ? "먼저 위에서 거래처를 등록해주세요." : "검색 결과가 없어요."}
                        </p>
                      ) : filteredClients.map((c) => (
                        <div key={c.id} className="flex items-center hover:bg-gray-50 group">
                          <button type="button" onClick={() => { setSelectedClientId(c.id); setClientMenuOpen(false); }}
                            className="flex-1 text-left px-3 py-2.5 text-xs">
                            <p className="font-medium text-gray-800">{c.clientName}</p>
                            <p className="text-gray-400">{c.bizNumber}{c.bizFileName ? ` · ${c.bizFileName}` : ""}</p>
                          </button>
                          <button type="button" onClick={() => handleDeleteClient(c.id)}
                            className="px-3 py-2 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
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
                    {/* 드롭다운 헤더 */}
                    <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-600 shrink-0">
                        정산제약사 {companies.length}개
                        {selected.size > 0 && <span className="text-blue-600 ml-1">({selected.size}개 선택)</span>}
                      </span>
                      <div className="flex items-center gap-1.5 ml-auto">
                        {/* 제안서 불러오기 */}
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
                    {/* 검색 */}
                    <div className="p-2 border-b border-gray-100">
                      <input
                        value={companySearch} onChange={(e) => setCompanySearch(e.target.value)}
                        placeholder="제약사명 검색..."
                        className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                    {/* 목록 */}
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
    </RequireAuth>
  );
}
