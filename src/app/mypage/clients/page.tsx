"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { useSession } from "next-auth/react";
import { Building2, Plus, Trash2, FileText, CheckCircle2, XCircle, Loader2, AlertCircle,
  Stethoscope, Briefcase, Pencil, MapPin, Filter, Send, Search, ChevronDown, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import RequireRole from "@/components/RequireRole";
import Link from "next/link";

/* ───── 거래처 등록 타입 ───── */
interface UserClient {
  id: string; clientName: string; bizNumber: string; address?: string | null;
  bizFileName: string | null; approved: boolean | null; createdAt: string;
  dealerType?: string | null; companies?: string[];
}
interface BizVerifyResult {
  valid: boolean | null; closed?: boolean; statusText?: string;
  taxType?: string; isMedicalLikely?: boolean; error?: string;
}

/* ───── 제약사 필터링 타입 ───── */
interface Company { name: string; isSettlement: boolean; count: number; }
interface ProposalSummary { id: string; title: string; _count?: { items: number }; }
interface MyRequest {
  id: string; clientName: string; bizNumber: string; companyName: string;
  status: string; replyText: string | null; repliedAt: string | null; createdAt: string;
}
interface GlobalClient { id: string; clientName: string; bizNumber: string; bizFileName?: string | null; }

function StatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") return <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded shrink-0">거래가능</span>;
  if (status === "REVIEWING") return <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-1.5 py-0.5 rounded shrink-0">검토중</span>;
  if (status === "PENDING") return <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded shrink-0">요청됨</span>;
  if (status === "REJECTED") return <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded shrink-0">거부됨</span>;
  return null;
}

function validateBizNumber(biz: string): boolean {
  const d = biz.replace(/\D/g, "");
  if (d.length !== 10) return false;
  const n = d.split("").map(Number);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += n[i] * w[i];
  sum += Math.floor(n[8] * 5 / 10);
  return (10 - (sum % 10)) % 10 === n[9];
}
function formatBizNumber(v: string) {
  const d = v.replace(/\D/g, "");
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5, 10)}`;
}

export default function ClientsPage() {
  const { data: session } = useSession();

  /* 박스 탭 */
  const [boxTab, setBoxTab] = useState<"register" | "filter">("register");

  /* ── 거래처 등록 state ── */
  const [clients, setClients] = useState<UserClient[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState<"all" | "medical" | "business">("all");
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [editingAddressVal, setEditingAddressVal] = useState("");
  const [name, setName] = useState("");
  const [biz, setBiz] = useState("");
  const [address, setAddress] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dealerType, setDealerType] = useState<"medical" | "business" | null>(null);
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState("");
  const [bizError, setBizError] = useState("");
  const [dupChecked, setDupChecked] = useState<"none" | "checking" | "ok" | "dup">("none");
  const [ntsResult, setNtsResult] = useState<BizVerifyResult | null>(null);
  const [ntsLoading, setNtsLoading] = useState(false);

  /* ── 제약사 필터링 state ── */
  const proposalMenuRef = useRef<HTMLDivElement>(null);
  const clientMenuRef = useRef<HTMLDivElement>(null);
  const companyMenuRef = useRef<HTMLDivElement>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<GlobalClient[]>([]);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [clientSearching, setClientSearching] = useState(false);
  const [selectedFilterClient, setSelectedFilterClient] = useState<GlobalClient | null>(null);
  const [myClients, setMyClients] = useState<GlobalClient[]>([]);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterSuccess, setFilterSuccess] = useState(false);
  const [filterError, setFilterError] = useState("");
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [showProposalMenu, setShowProposalMenu] = useState(false);
  const [companyStatuses, setCompanyStatuses] = useState<Record<string, string>>({});
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);

  /* ── 초기 로드 ── */
  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/user-clients").then((r) => r.json()).then((d) => setClients(Array.isArray(d) ? d : [])).finally(() => setListLoading(false));
    fetch("/api/medications/companies").then((r) => r.json()).then(setCompanies);
    fetch(`/api/proposals?userId=${session.user.id}`).then((r) => r.json()).then((d) => setProposals(Array.isArray(d) ? d : []));
    fetch(`/api/filter-request/company-status?userId=${session.user.id}`).then((r) => r.json()).then(setCompanyStatuses);
    loadMyRequests(session.user.id);
  }, [session?.user?.id]);

  useEffect(() => {
    fetch("/api/user-clients").then((r) => r.json()).then((d) => setMyClients(Array.isArray(d) ? d : []));
  }, [clients]);

  /* 거래처 debounced 검색 */
  useEffect(() => {
    if (!clientQuery.trim()) { setClientResults([]); setClientSearching(false); return; }
    setClientSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?q=${encodeURIComponent(clientQuery.trim())}`);
        setClientResults(Array.isArray(await res.json()) ? await fetch(`/api/clients?q=${encodeURIComponent(clientQuery.trim())}`).then(r => r.json()) : []);
      } finally { setClientSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [clientQuery]);

  /* 드롭다운 외부 클릭 닫기 */
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (proposalMenuRef.current && !proposalMenuRef.current.contains(e.target as Node)) setShowProposalMenu(false);
      if (!clientMenuOpen && !companyMenuOpen) return;
      if (clientMenuRef.current && !clientMenuRef.current.contains(e.target as Node)) setClientMenuOpen(false);
      if (companyMenuRef.current && !companyMenuRef.current.contains(e.target as Node)) setCompanyMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [clientMenuOpen, companyMenuOpen]);

  async function loadMyRequests(uid: string) {
    const res = await fetch(`/api/filter-request?userId=${uid}`);
    const data = await res.json();
    setMyRequests(Array.isArray(data) ? data : []);
  }

  async function loadFromProposal(proposalId: string) {
    setShowProposalMenu(false);
    const res = await fetch(`/api/proposals/${proposalId}`);
    const data = await res.json();
    const names = new Set<string>((data.items || []).map((item: { altMedication?: { companyName?: string } }) => item.altMedication?.companyName).filter(Boolean));
    setSelected(names);
  }

  const filteredCompanies = companies.filter((c) => !companySearch.trim() || c.name.toLowerCase().includes(companySearch.toLowerCase()));
  const displayClients = clientQuery.trim() ? clientResults : myClients;

  function toggleCompany(name: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }

  /* ── 거래처 등록 핸들러 ── */
  async function handleBizChange(val: string) {
    const formatted = formatBizNumber(val);
    setBiz(formatted); setBizError(""); setDupChecked("none"); setNtsResult(null); setDealerType(null);
    const digits = formatted.replace(/\D/g, "");
    if (digits.length === 10) {
      if (!validateBizNumber(formatted)) { setBizError("유효하지 않은 사업자등록번호예요."); return; }
      setDupChecked("checking");
      const res = await fetch(`/api/user-clients?bizNumber=${digits}`);
      if ((await res.json()).found) { setDupChecked("dup"); return; }
      setDupChecked("ok");
      setNtsLoading(true);
      try {
        const ntsData: BizVerifyResult = await fetch("/api/biz-verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bizNumber: digits }) }).then(r => r.json());
        setNtsResult(ntsData);
        if (ntsData.valid === true) setDealerType(ntsData.isMedicalLikely ? "medical" : "business");
      } catch { setNtsResult({ valid: null, error: "국세청 조회 실패" }); }
      finally { setNtsLoading(false); }
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault(); setRegError("");
    if (!name.trim() || !biz.trim()) { setRegError("거래처명과 사업자번호를 입력해주세요."); return; }
    if (bizError) { setRegError(bizError); return; }
    if (dupChecked === "dup") { setRegError("이미 등록된 사업자번호예요."); return; }
    const digits = biz.replace(/\D/g, "");
    if (!validateBizNumber(digits)) { setRegError("유효하지 않은 사업자등록번호예요."); return; }
    setRegistering(true);
    let bizDocument: string | null = null, bizFileName: string | null = null;
    if (file) {
      bizDocument = await new Promise<string>((resolve) => { const r = new FileReader(); r.readAsDataURL(file); r.onload = () => resolve(r.result as string); });
      bizFileName = file.name;
    }
    const res = await fetch("/api/user-clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientName: name.trim(), bizNumber: digits, address: address.trim() || null, bizDocument, bizFileName, dealerType: dealerType === "business" ? "BUSINESS" : null }) });
    if (res.ok) {
      const newClient = await res.json();
      setClients((prev) => [newClient, ...prev]);
      setName(""); setBiz(""); setAddress(""); setFile(null); setDupChecked("none"); setNtsResult(null); setDealerType(null);
    } else { setRegError((await res.json()).error || "등록 중 오류가 발생했어요."); }
    setRegistering(false);
  }

  async function handleDelete(id: string, clientName: string) {
    if (!confirm(`"${clientName}" 거래처를 삭제할까요?`)) return;
    const res = await fetch(`/api/user-clients?id=${id}`, { method: "DELETE" });
    if (res.ok) setClients((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleSaveAddress(id: string) {
    const res = await fetch(`/api/user-clients?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: editingAddressVal.trim() || null }) });
    if (res.ok) { setClients((prev) => prev.map((c) => c.id === id ? { ...c, address: editingAddressVal.trim() || null } : c)); setEditingAddressId(null); }
  }

  /* ── 필터링 제출 ── */
  async function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault(); setFilterError("");
    if (selected.size === 0) { setFilterError("제약사를 1개 이상 선택해주세요."); return; }
    if (!selectedFilterClient) { setFilterError("거래처를 선택해주세요."); return; }
    setFilterLoading(true);
    const res = await fetch("/api/filter-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: session!.user.id, userName: session!.user.name || session!.user.email, clientName: selectedFilterClient.clientName, bizNumber: selectedFilterClient.bizNumber, companies: Array.from(selected) }) });
    if (res.ok) {
      setFilterSuccess(true); setSelected(new Set());
      fetch(`/api/filter-request/company-status?userId=${session!.user.id}`).then((r) => r.json()).then(setCompanyStatuses);
      loadMyRequests(session!.user.id);
    } else { setFilterError((await res.json()).error || "요청 중 오류가 발생했어요."); }
    setFilterLoading(false);
  }

  const filteredList = clients.filter((c) => clientFilter === "all" ? true : clientFilter === "business" ? !!c.dealerType : !c.dealerType);

  return (
    <RequireRole minRole="BASIC">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-blue-600" />거래처관리(의료기관)
          </h1>
          <p className="text-gray-500 text-sm mt-1">거래처를 등록하면 제약사 필터링·제안서 등 모든 서비스에서 바로 사용할 수 있습니다.</p>
        </div>

        {/* 등록 + 필터링 박스 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* 탭 */}
          <div className="flex border-b border-gray-100">
            {([["register", Building2, "거래처 등록"], ["filter", Filter, "제약사 필터링"]] as const).map(([t, Icon, label]) => (
              <button key={t} onClick={() => setBoxTab(t)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors ${boxTab === t ? "text-orange-600 border-b-2 border-orange-500 bg-orange-50/30" : "text-gray-500 hover:text-gray-700"}`}>
                <Icon className="w-4 h-4" />{label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {/* ── 거래처 등록 탭 ── */}
            {boxTab === "register" && (
              <form onSubmit={handleRegister} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">거래처명 <span className="text-red-500">*</span></label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="상호명" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">사업자등록번호 <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <Input value={biz} onChange={(e) => handleBizChange(e.target.value)} placeholder="000-00-00000" maxLength={12}
                        className={bizError || dupChecked === "dup" ? "border-red-400 pr-9" : dupChecked === "ok" ? "border-green-400 pr-9" : "pr-9"} />
                      {(dupChecked === "checking" || ntsLoading) && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />}
                      {dupChecked === "ok" && !ntsLoading && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
                      {dupChecked === "dup" && <XCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />}
                    </div>
                    {bizError && <p className="text-xs text-red-500">{bizError}</p>}
                    {dupChecked === "dup" && !bizError && <p className="text-xs text-red-500">이미 등록된 사업자번호예요.</p>}
                    {dupChecked === "ok" && !ntsLoading && !ntsResult && <p className="text-xs text-green-600">사용 가능한 사업자번호예요. ✓</p>}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">주소 <span className="text-gray-400 font-normal">(선택)</span></label>
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="예: 서울시 강남구 테헤란로 123" />
                </div>
                {ntsResult && dupChecked === "ok" && (
                  <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${ntsResult.valid === null ? "bg-gray-50 text-gray-500 border border-gray-200" : ntsResult.valid === false ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-800 border border-green-200"}`}>
                    {ntsResult.valid === null && <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                    {ntsResult.valid === false && <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                    {ntsResult.valid === true && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
                    <div>
                      {ntsResult.valid === null && <p>국세청 조회 불가 — 수동으로 거래처 유형을 선택해주세요.</p>}
                      {ntsResult.valid === false && <p>{ntsResult.closed ? "폐업된 사업자입니다." : `사업자 상태: ${ntsResult.statusText || "확인 불가"}`}</p>}
                      {ntsResult.valid === true && <div><p className="font-medium">국세청 조회 완료 ✓</p><p className="text-xs mt-0.5 opacity-80">상태: {ntsResult.statusText} · 과세유형: {ntsResult.taxType}{ntsResult.isMedicalLikely && " · 면세사업자 (의료기관 가능성 높음)"}</p></div>}
                    </div>
                  </div>
                )}
                {dupChecked === "ok" && !bizError && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600">거래처 유형 <span className="text-red-500">*</span>{ntsResult?.isMedicalLikely && <span className="ml-1 text-green-600 font-normal">(국세청 조회 기준 자동 선택됨)</span>}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setDealerType("medical")} className={`flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors ${dealerType === "medical" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-gray-300 text-gray-600"}`}>
                        <Stethoscope className="w-4 h-4 shrink-0" /><div><p className="text-sm font-medium">의료기관</p><p className="text-xs opacity-70">병의원·약국</p></div>
                      </button>
                      <button type="button" onClick={() => setDealerType("business")} className={`flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors ${dealerType === "business" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-gray-300 text-gray-600"}`}>
                        <Briefcase className="w-4 h-4 shrink-0" /><div><p className="text-sm font-medium">사업자</p><p className="text-xs opacity-70">도매·법인·기타</p></div>
                      </button>
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">사업자등록증 <span className="text-gray-400 font-normal">(선택)</span></label>
                  <label className="flex items-center gap-2 border border-dashed border-gray-300 rounded-lg p-3 cursor-pointer hover:bg-gray-50 transition-colors">
                    <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-500 truncate flex-1">{file ? file.name : "파일 첨부 (JPG, PNG, PDF)"}</span>
                    {file && <button type="button" onClick={(e) => { e.preventDefault(); setFile(null); }} className="text-xs text-gray-400 hover:text-red-500">제거</button>}
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  </label>
                </div>
                {regError && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{regError}</p>}
                <Button type="submit" disabled={registering || dupChecked === "dup" || !!bizError || !dealerType} className="w-full">
                  {registering ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />등록 중...</> : <><Plus className="w-4 h-4 mr-2" />거래처 등록</>}
                </Button>
                {dupChecked === "ok" && !dealerType && <p className="text-xs text-center text-gray-400">거래처 유형을 선택해야 등록할 수 있어요.</p>}
              </form>
            )}

            {/* ── 제약사 필터링 탭 ── */}
            {boxTab === "filter" && (
              filterSuccess ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center space-y-2">
                  <p className="text-green-700 font-semibold">조회 요청이 등록됐어요!</p>
                  <p className="text-green-600 text-sm">관리자가 확인 후 회신드릴게요.</p>
                  <button onClick={() => setFilterSuccess(false)} className="mt-2 text-sm text-green-700 border border-green-300 px-4 py-2 rounded-lg hover:bg-green-100">새 요청하기</button>
                </div>
              ) : (
                <form onSubmit={handleFilterSubmit} className="space-y-4">
                  {/* 거래처 선택 */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-gray-600">거래처 선택 <span className="text-red-500">*</span></label>
                    </div>
                    <div className="relative" ref={clientMenuRef}>
                      <button type="button" onClick={() => setClientMenuOpen((v) => !v)}
                        className="w-full h-10 px-3 border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-left text-sm flex items-center justify-between gap-2">
                        {selectedFilterClient ? (
                          <span className="flex items-center gap-2 flex-1 min-w-0">
                            <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
                            <span className="font-medium text-gray-800 truncate">{selectedFilterClient.clientName}</span>
                            <span className="text-gray-400 font-mono text-xs shrink-0">{selectedFilterClient.bizNumber}</span>
                          </span>
                        ) : (
                          <span className="text-gray-400 flex items-center gap-1.5"><Search className="w-3.5 h-3.5" />거래처 검색 및 선택</span>
                        )}
                        <div className="flex items-center gap-1 shrink-0">
                          {selectedFilterClient && <span onClick={(e) => { e.stopPropagation(); setSelectedFilterClient(null); setClientQuery(""); }} className="p-0.5 text-gray-400 hover:text-gray-600 rounded"><X className="w-3.5 h-3.5" /></span>}
                          <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${clientMenuOpen ? "rotate-180" : ""}`} />
                        </div>
                      </button>
                      {clientMenuOpen && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
                          <div className="p-2 border-b border-gray-100">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                              <input autoFocus value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="거래처명 또는 사업자번호 검색..."
                                className="w-full h-8 pl-8 pr-8 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                              {clientSearching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-gray-400" />}
                            </div>
                          </div>
                          <div className="max-h-56 overflow-y-auto">
                            {displayClients.length === 0 ? (
                              <div className="py-5 px-3 text-center">
                                <p className="text-xs text-gray-400">{clientQuery.trim() ? `'${clientQuery}'에 해당하는 거래처가 없어요` : "등록된 거래처가 없어요"}</p>
                              </div>
                            ) : (
                              <>
                                {!clientQuery.trim() && <p className="px-3 py-1.5 text-[11px] text-gray-400 border-b border-gray-50">내 거래처</p>}
                                {displayClients.map((c) => (
                                  <button key={c.id} type="button" onClick={() => { setSelectedFilterClient(c); setClientMenuOpen(false); setClientQuery(""); }}
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

                  {/* 제약사 선택 */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">제약사 선택 <span className="text-red-500">*</span></label>
                    <div className="relative" ref={companyMenuRef}>
                      <button type="button" onClick={() => setCompanyMenuOpen((v) => !v)}
                        className="w-full h-10 px-3 border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-left text-sm flex items-center justify-between">
                        {selected.size > 0 ? <span className="text-gray-800 font-medium">{selected.size}개 선택됨</span> : <span className="text-gray-400 flex items-center gap-1.5"><Search className="w-3.5 h-3.5" />제약사 검색 및 선택</span>}
                        <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
                      </button>
                      {companyMenuOpen && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
                          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-gray-600 shrink-0">정산제약사 {companies.length}개{selected.size > 0 && <span className="text-blue-600 ml-1">({selected.size}개 선택)</span>}</span>
                            <div className="flex items-center gap-1.5 ml-auto">
                              <div className="relative" ref={proposalMenuRef}>
                                <button type="button" onClick={() => setShowProposalMenu((v) => !v)}
                                  className="flex items-center gap-1 text-xs text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 px-2 py-1 rounded transition-colors whitespace-nowrap">
                                  <FileText className="w-3 h-3" />제안서<ChevronDown className="w-3 h-3" />
                                </button>
                                {showProposalMenu && (
                                  <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[160px] max-h-48 overflow-y-auto">
                                    {proposals.length === 0 ? <p className="text-xs text-gray-400 px-3 py-2">제안서가 없어요</p> :
                                      proposals.map((p) => <button key={p.id} onClick={() => loadFromProposal(p.id)} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-b border-gray-50 last:border-0"><p className="font-medium text-gray-800 truncate">{p.title}</p><p className="text-gray-400">{p._count?.items ?? 0}개 품목</p></button>)}
                                  </div>
                                )}
                              </div>
                              {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-0.5 whitespace-nowrap"><X className="w-3 h-3" />전체해제</button>}
                            </div>
                          </div>
                          <div className="p-2 border-b border-gray-100">
                            <input value={companySearch} onChange={(e) => setCompanySearch(e.target.value)} placeholder="제약사명 검색..."
                              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                          </div>
                          <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                            {filteredCompanies.length === 0 ? <p className="text-center text-xs text-gray-400 py-6">검색 결과가 없어요.</p> :
                              filteredCompanies.map((company) => (
                                <label key={company.name} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 cursor-pointer">
                                  <input type="checkbox" checked={selected.has(company.name)} onChange={() => toggleCompany(company.name)} className="w-4 h-4 rounded border-gray-300 text-blue-600 shrink-0" />
                                  <span className="flex-1 text-sm text-gray-800 truncate">{company.name}</span>
                                  {companyStatuses[company.name] && <StatusBadge status={companyStatuses[company.name]} />}
                                </label>
                              ))}
                          </div>
                          <div className="border-t border-gray-100 p-2">
                            <button type="button" onClick={() => setCompanyMenuOpen(false)} className="w-full py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors">
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
                      {Array.from(selected).map((n) => (
                        <span key={n} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded-full">
                          <Building2 className="w-3 h-3 shrink-0" />{n}
                          {companyStatuses[n] && <StatusBadge status={companyStatuses[n]} />}
                          <button type="button" onClick={() => toggleCompany(n)} className="hover:text-red-500 ml-0.5">×</button>
                        </span>
                      ))}
                    </div>
                  )}

                  {filterError && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{filterError}</p>}
                  <Button type="submit" className="w-full" disabled={filterLoading || selected.size === 0 || !selectedFilterClient}>
                    <Send className="w-4 h-4 mr-2" />{filterLoading ? "요청 중..." : `${selected.size}개 제약사 조회 등록`}
                  </Button>
                </form>
              )
            )}
          </div>
        </div>

        {/* 내 조회 요청 내역 (필터링 탭 활성 시) */}
        {boxTab === "filter" && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">내 조회 요청 내역 ({myRequests.length}건)</h2>
              <button type="button" onClick={() => session?.user?.id && loadMyRequests(session.user.id)} className="text-xs text-gray-500 hover:text-gray-700">새로고침</button>
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
                              <div className="text-xs text-blue-800"><span className="font-semibold">관리자 회신</span>{r.repliedAt && <span className="text-blue-400 ml-2">({new Date(r.repliedAt).toLocaleString("ko-KR")})</span>}</div>
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
        )}

        {/* 등록된 거래처 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">등록된 거래처<span className="ml-2 text-sm font-normal text-gray-400">({clients.length}개)</span></h2>
            <div className="flex gap-1">
              {(["all", "medical", "business"] as const).map((f) => (
                <button key={f} onClick={() => setClientFilter(f)}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${clientFilter === f ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                  {f === "all" ? "전체" : f === "medical" ? "의료기관" : "사업자"}
                </button>
              ))}
            </div>
          </div>
          {listLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : filteredList.length === 0 ? (
            <div className="text-center py-12"><Building2 className="w-8 h-8 text-gray-200 mx-auto mb-2" /><p className="text-sm text-gray-400">아직 등록된 거래처가 없어요</p></div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredList.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50">
                  {c.dealerType ? <Briefcase className="w-4 h-4 text-gray-300 shrink-0" /> : <Stethoscope className="w-4 h-4 text-gray-300 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{c.clientName}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{c.bizNumber}</p>
                    {editingAddressId === c.id ? (
                      <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                        <Input autoFocus value={editingAddressVal} onChange={(e) => setEditingAddressVal(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleSaveAddress(c.id); if (e.key === "Escape") setEditingAddressId(null); }}
                          placeholder="주소 입력" className="h-6 text-xs py-0 px-2" />
                        <button onClick={() => handleSaveAddress(c.id)} className="text-[10px] text-white bg-orange-500 hover:bg-orange-600 rounded px-1.5 py-0.5 shrink-0">저장</button>
                        <button onClick={() => setEditingAddressId(null)} className="text-[10px] text-gray-400 hover:text-gray-600 shrink-0">취소</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingAddressId(c.id); setEditingAddressVal(c.address ?? ""); }} className="flex items-center gap-1 mt-0.5 group">
                        <MapPin className="w-3 h-3 text-gray-300 group-hover:text-orange-400 shrink-0" />
                        <span className="text-xs text-gray-500 group-hover:text-orange-500 truncate">{c.address || <span className="text-gray-300">주소 추가</span>}</span>
                      </button>
                    )}
                    {c.companies && c.companies.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {c.companies.map((co) => <span key={co} className="text-[10px] bg-orange-50 text-orange-600 border border-orange-200 rounded-full px-1.5 py-0.5 leading-none">{co}</span>)}
                      </div>
                    )}
                    {c.companies && c.companies.length === 0 && <p className="text-[10px] text-gray-300 mt-1">거래 제약사 없음</p>}
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 border ${c.dealerType ? "text-purple-600 bg-purple-50 border-purple-100" : "text-blue-600 bg-blue-50 border-blue-100"}`}>
                    {c.dealerType ? "사업자" : "의료기관"}
                  </span>
                  {c.bizFileName && <span className="text-xs text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded shrink-0">서류첨부</span>}
                  <span className="text-xs text-gray-400 shrink-0">{new Date(c.createdAt).toLocaleDateString("ko-KR")}</span>
                  <button onClick={() => handleDelete(c.id, c.clientName)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </RequireRole>
  );
}
