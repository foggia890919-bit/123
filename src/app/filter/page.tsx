"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { Building2, Filter, X, Upload, Send, FileText, ChevronDown } from "lucide-react";
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
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clientName, setClientName] = useState("");
  const [bizNumber, setBizNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
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

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/proposals?userId=${session.user.id}`)
      .then((r) => r.json())
      .then((d) => setProposals(Array.isArray(d) ? d : []));
    fetch(`/api/filter-request/company-status?userId=${session.user.id}`)
      .then((r) => r.json())
      .then(setCompanyStatuses);
    loadMyRequests(session.user.id);
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
  }

  const filteredCompanies = companies.filter((c) =>
    c.name.toLowerCase().includes(companySearch.toLowerCase())
  );

  function toggleCompany(name: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }

  function formatBizNumber(v: string) {
    const d = v.replace(/\D/g, "");
    if (d.length <= 3) return d;
    if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5, 10)}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (selected.size === 0) { setError("제약사를 1개 이상 선택해주세요."); return; }
    if (!clientName || !bizNumber) { setError("거래처명과 사업자등록번호를 입력해주세요."); return; }

    setLoading(true);
    let bizDocument = null, bizFileName = null;
    if (file) {
      bizDocument = await new Promise<string>((res) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => res(reader.result as string);
      });
      bizFileName = file.name;
    }

    const res = await fetch("/api/filter-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session!.user.id,
        userName: session!.user.name || session!.user.email,
        clientName, bizNumber, bizDocument, bizFileName,
        companies: Array.from(selected),
      }),
    });

    if (res.ok) {
      setSuccess(true);
      setSelected(new Set()); setClientName(""); setBizNumber(""); setFile(null);
      // Refresh statuses + 내 요청 목록
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
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Filter className="w-6 h-6 text-blue-600" />제약사 필터링
          </h1>
          <p className="text-gray-500 text-sm mt-1">제약사를 선택하고 거래처 정보를 입력하면 관리자가 거래 가능 여부를 확인해드립니다</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* 제약사 목록 */}
          <div className="md:col-span-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-800 shrink-0">정산제약사 ({companies.length}개)</span>
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
                    <button onClick={() => setSelected(new Set())} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
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
                  {companyStatuses[company.name] && <StatusBadge status={companyStatuses[company.name]} />}
                </label>
              ))}
            </div>
          </div>

          {/* 거래처 정보 입력 + 내 요청 내역 */}
          <div className="md:col-span-2 space-y-4">
            {success ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center space-y-2">
                <p className="text-green-700 font-semibold">조회 요청이 등록됐어요!</p>
                <p className="text-green-600 text-sm">관리자가 확인 후 회신드릴게요.</p>
                <button onClick={() => setSuccess(false)} className="mt-2 text-sm text-green-700 border border-green-300 px-4 py-2 rounded-lg hover:bg-green-100">
                  새 요청하기
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
                <h2 className="font-semibold text-gray-800">거래처 정보 입력</h2>

                {selected.size > 0 && (
                  <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="text-xs text-gray-500">선택된 제약사 ({selected.size}개)</span>
                      <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                        <X className="w-3 h-3" />전체 제거
                      </button>
                    </div>
                    {Array.from(selected).map((name) => (
                      <span key={name} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded-full">
                        <Building2 className="w-3 h-3" />{name}
                        {companyStatuses[name] && <StatusBadge status={companyStatuses[name]} />}
                        <button type="button" onClick={() => toggleCompany(name)} className="hover:text-red-500 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">거래처명 <span className="text-red-500">*</span></label>
                  <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="거래처 상호명" required />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">사업자등록번호 <span className="text-red-500">*</span></label>
                  <Input value={bizNumber} onChange={(e) => setBizNumber(formatBizNumber(e.target.value))}
                    placeholder="000-00-00000" maxLength={12} required />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">사업자등록증 <span className="text-gray-400 font-normal">(선택)</span></label>
                  <div onClick={() => fileRef.current?.click()}
                    className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${file ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400"}`}>
                    <Upload className="w-5 h-5 text-gray-400 mx-auto mb-1" />
                    <p className="text-sm text-gray-500">{file ? <span className="font-medium text-gray-800">{file.name}</span> : "클릭해서 파일 첨부"}</p>
                    <p className="text-xs text-gray-400 mt-0.5">JPG, PNG, PDF 지원</p>
                    <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  </div>
                </div>

                {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

                <Button type="submit" className="w-full" disabled={loading || selected.size === 0}>
                  <Send className="w-4 h-4 mr-2" />
                  {loading ? "요청 중..." : `${selected.size}개 제약사 조회 등록`}
                </Button>
              </form>
            )}

            {/* 내 요청 내역 */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800 text-sm">내 조회 요청 내역 ({myRequests.length}건)</h2>
                <button
                  type="button"
                  onClick={() => session?.user?.id && loadMyRequests(session.user.id)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >새로고침</button>
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
        </div>
      </div>
    </RequireAuth>
  );
}
