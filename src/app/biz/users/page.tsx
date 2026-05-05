"use client";

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Hospital, Building2, UserCheck, Search, Plus, Trash2, Loader2, Upload,
  X, AlertCircle, Hash, CheckCircle, Clock, Tag, ChevronDown, Pencil,
  Users, FileSpreadsheet, AlertTriangle, XCircle,
  RefreshCw, ToggleLeft, ToggleRight, KeyRound, CheckCircle2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { BizLayout } from "@/app/biz/page";

// ─── 공통 ─────────────────────────────────────────────────────────────────────

function formatBiz(n: string) {
  const d = n.replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  return n;
}
function formatBizNum(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}
async function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.readAsDataURL(file);
  });
}

// ─── 병·의원 탭 ───────────────────────────────────────────────────────────────

interface HospClient {
  id: string;
  clientName: string;
  bizNumber: string;
  bizFileName?: string;
  approved: boolean;
  createdAt: string;
  code?: string | null;
}
interface GlobalClient { clientName: string; bizNumber: string; }
type ModalStep = "search" | "found" | "new" | "notfound" | "saving";

function ClientsTab() {
  const [clients, setClients] = useState<HospClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const [step, setStep] = useState<ModalStep>("search");
  const [searchQ, setSearchQ] = useState("");
  const [suggestions, setSuggestions] = useState<GlobalClient[]>([]);
  const [sugLoading, setSugLoading] = useState(false);
  const [showSug, setShowSug] = useState(false);
  const [selectedClient, setSelectedClient] = useState<GlobalClient | null>(null);
  const [existingName, setExistingName] = useState<string | null>(null);
  const [noResults, setNoResults] = useState(false);
  const [bizFile, setBizFile] = useState<File | null>(null);
  const [newName, setNewName] = useState("");
  const [newBizNum, setNewBizNum] = useState("");
  const [formError, setFormError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploadingForId, setUploadingForId] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    fetch("/api/user-clients")
      .then((r) => r.json())
      .then((d) => setClients(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  const fetchSuggestions = useCallback((q: string) => {
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setSuggestions([]); setShowSug(false); setNoResults(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSugLoading(true); setNoResults(false);
      try {
        const res = await fetch(`/api/filter-mapping/suggestions?type=client&q=${encodeURIComponent(q)}`);
        const d = await res.json();
        const results = Array.isArray(d) ? d : [];
        setSuggestions(results); setShowSug(results.length > 0); setNoResults(results.length === 0);
      } finally { setSugLoading(false); }
    }, 200);
  }, []);

  async function selectClient(gc: GlobalClient) {
    setShowSug(false);
    setSearchQ(`${gc.clientName} (${formatBiz(gc.bizNumber)})`);
    setSelectedClient(gc); setFormError("");
    const res = await fetch(`/api/user-clients?bizNumber=${gc.bizNumber.replace(/\D/g, "")}`);
    const d = await res.json();
    if (d.found) { setExistingName(d.client.clientName); setStep("found"); }
    else { setExistingName(null); setStep("new"); }
  }

  function openModal() {
    setStep("search"); setSearchQ(""); setSuggestions([]); setShowSug(false);
    setSelectedClient(null); setExistingName(null); setNoResults(false);
    setBizFile(null); setNewName(""); setNewBizNum(""); setFormError(""); setModal(true);
  }

  function formatSearchInput(v: string): string {
    const lettersOnly = v.replace(/[\d\-\s]/g, "");
    if (lettersOnly.length > 0) return v;
    return formatBizNum(v);
  }

  async function handleAdd() {
    setFormError("");
    const isNotFound = step === "notfound";
    if (isNotFound) {
      if (!newName.trim() || !newBizNum.trim()) { setFormError("거래처명과 사업자번호를 입력해주세요."); return; }
      setStep("saving");
      let bizDocument: string | null = null, bizFileName: string | null = null;
      if (bizFile) { bizFileName = bizFile.name; bizDocument = await fileToDataUri(bizFile); }
      const cr = await fetch("/api/clients", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName: newName.trim(), bizNumber: newBizNum.trim(), bizDocument, bizFileName }),
      });
      if (!cr.ok) { const d = await cr.json(); setFormError(d.error ?? "등록 실패"); setStep("notfound"); return; }
      const globalClient: GlobalClient = await cr.json();
      const ur = await fetch("/api/user-clients", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName: globalClient.clientName, bizNumber: globalClient.bizNumber, bizDocument, bizFileName }),
      });
      if (ur.ok) { const row = await ur.json(); setClients((p) => [row, ...p]); setModal(false); }
      else { const d = await ur.json(); setFormError(d.error ?? "등록 실패"); setStep("notfound"); }
      return;
    }
    if (!selectedClient) { setFormError("거래처를 선택해주세요."); return; }
    setStep("saving");
    let bizDocument: string | null = null, bizFileName: string | null = null;
    if (bizFile) { bizFileName = bizFile.name; bizDocument = await fileToDataUri(bizFile); }
    const res = await fetch("/api/user-clients", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientName: selectedClient.clientName, bizNumber: selectedClient.bizNumber, bizDocument, bizFileName }),
    });
    if (res.ok) { const row = await res.json(); setClients((p) => [row, ...p]); setModal(false); }
    else { const d = await res.json(); setFormError(d.error ?? "등록 실패"); setStep("new"); }
  }

  async function handleDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file || !uploadingForId) return;
    const fr = new FileReader();
    fr.onload = async () => {
      const bizDocument = fr.result as string;
      const res = await fetch(`/api/user-clients?id=${uploadingForId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bizDocument, bizFileName: file.name }),
      });
      if (res.ok) setClients((prev) => prev.map((c) => c.id === uploadingForId ? { ...c, bizFileName: file.name } : c));
      setUploadingForId(null);
    };
    fr.readAsDataURL(file);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}"을(를) 삭제할까요?`)) return;
    await fetch(`/api/user-clients?id=${id}`, { method: "DELETE" });
    setClients((p) => p.filter((c) => c.id !== id));
  }

  async function generateCode(id: string) {
    setGeneratingCode(id);
    try {
      const res = await fetch("/api/generate-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "hospital", id }),
      });
      const data = await res.json();
      if (data.code) setClients((p) => p.map((c) => c.id === id ? { ...c, code: data.code } : c));
    } finally { setGeneratingCode(null); }
  }

  const filtered = clients.filter((c) => c.clientName.includes(query) || c.bizNumber.includes(query));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">KMD 전체 거래처 풀에서 선택해 등록합니다</p>
        <button onClick={openModal}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
          <Plus className="w-3.5 h-3.5" />병의원 추가
        </button>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="병의원명 또는 사업자번호 검색" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9 text-sm" />
      </div>
      <input ref={uploadRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleDocUpload} />
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
          {query ? "검색 결과가 없습니다" : "등록된 병의원이 없습니다"}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] text-xs font-semibold text-gray-500 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            <span>병의원명</span>
            <span className="text-center w-32">사업자번호</span>
            <span className="text-center w-24">병의원 코드</span>
            <span className="text-center w-20">상태</span>
            <span className="w-16" />
          </div>
          <div className="divide-y divide-gray-50">
            {filtered.map((c) => (
              <div key={c.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                    <Hospital className="w-4 h-4 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{c.clientName}</p>
                    {c.bizFileName && <p className="text-xs text-gray-400">{c.bizFileName}</p>}
                  </div>
                </div>
                <span className="text-sm text-gray-500 w-32 text-center">{formatBiz(c.bizNumber)}</span>
                <div className="w-24 flex justify-center">
                  {c.code ? (
                    <span className="inline-flex items-center gap-1 text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                      <Hash className="w-3 h-3" />{c.code}
                    </span>
                  ) : (
                    <button onClick={() => generateCode(c.id)} disabled={generatingCode === c.id}
                      className="flex items-center gap-1 text-xs px-2 py-0.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                      {generatingCode === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hash className="w-3 h-3" />}
                      코드생성
                    </button>
                  )}
                </div>
                <div className="w-20 flex justify-center">
                  {c.approved
                    ? <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><CheckCircle className="w-3.5 h-3.5" />승인</span>
                    : <span className="flex items-center gap-1 text-xs text-yellow-600 font-medium"><Clock className="w-3.5 h-3.5" />대기</span>}
                </div>
                <div className="w-16 flex justify-end items-center gap-1">
                  <button onClick={() => { setUploadingForId(c.id); uploadRef.current?.click(); }}
                    className="text-gray-300 hover:text-blue-500 transition-colors" title="사업자등록증 업로드">
                    <Upload className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(c.id, c.clientName)} className="text-gray-300 hover:text-red-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-gray-400 text-right">총 {filtered.length}개{query && ` (전체 ${clients.length}개 중)`}</p>

      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">병의원 등록</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-600">거래처명 또는 사업자번호 검색 *</label>
                <div className="relative">
                  <input value={searchQ}
                    onChange={(e) => {
                      const f = formatSearchInput(e.target.value);
                      setSearchQ(f); setSelectedClient(null); setStep("search");
                      setFormError(""); setNoResults(false); fetchSuggestions(f);
                    }}
                    onFocus={() => { if (suggestions.length > 0) setShowSug(true); }}
                    placeholder="병의원명 또는 사업자번호 입력" disabled={step === "saving"}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 pr-8"
                  />
                  {sugLoading && <Loader2 className="absolute right-2.5 top-2.5 w-4 h-4 animate-spin text-gray-400" />}
                  {showSug && suggestions.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {suggestions.map((s, i) => (
                        <button key={i} type="button" onMouseDown={(e) => { e.preventDefault(); selectClient(s); }}
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 border-b border-gray-50 last:border-0">
                          <p className="font-medium text-gray-800">{s.clientName}</p>
                          <p className="text-xs text-gray-400 font-mono">{formatBiz(s.bizNumber)}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-400">KMD에 등록된 전체 거래처에서 검색합니다</p>
              </div>
              {step === "found" && (
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-amber-800">이미 내 거래처에 등록되어 있습니다</p>
                    <p className="text-xs text-amber-700 mt-0.5">{existingName}</p>
                  </div>
                </div>
              )}
              {noResults && step === "search" && searchQ.trim() && !sugLoading && (
                <div className="text-center py-2">
                  <p className="text-xs text-gray-400 mb-2">'{searchQ}'에 해당하는 거래처가 없어요</p>
                  <button type="button" onClick={() => {
                    setStep("notfound");
                    const digitsOnly = searchQ.replace(/\D/g, "");
                    const isBizSearch = digitsOnly.length > 0 && searchQ.trim().replace(/-/g, "") === digitsOnly;
                    if (isBizSearch) { setNewBizNum(searchQ.trim()); setNewName(""); }
                    else { setNewName(searchQ.trim()); setNewBizNum(""); }
                  }} className="inline-flex items-center gap-1 text-xs text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-md">
                    <Plus className="w-3 h-3" />새 거래처로 직접 등록
                  </button>
                </div>
              )}
              {(step === "notfound" || (step === "saving" && !selectedClient)) && (
                <div className="space-y-3 border border-blue-100 bg-blue-50/40 rounded-lg p-3">
                  <p className="text-xs font-semibold text-blue-800">새 거래처 등록</p>
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <label className="text-xs text-gray-600 font-medium">거래처명 *</label>
                      <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="병의원 상호명" className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-600 font-medium">사업자번호 *</label>
                      <Input value={newBizNum} onChange={(e) => setNewBizNum(formatBizNum(e.target.value))} placeholder="000-00-00000" maxLength={12} className="h-8 text-xs" />
                    </div>
                  </div>
                  {formError && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{formError}</p>}
                </div>
              )}
              {(step === "new" || (step === "saving" && selectedClient)) && selectedClient && (
                <>
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-green-800">{selectedClient.clientName}</p>
                      <p className="text-xs text-green-700 font-mono">{formatBiz(selectedClient.bizNumber)}</p>
                    </div>
                  </div>
                  {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}
                </>
              )}
              {(step === "new" || step === "notfound") && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-600">사업자등록증 (선택)</label>
                  <div onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2.5 border border-dashed border-gray-300 rounded-lg px-3 py-2.5 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30">
                    <Upload className="w-4 h-4 text-gray-400 shrink-0" />
                    <p className={`text-xs truncate ${bizFile ? "text-blue-600 font-medium" : "text-gray-400"}`}>
                      {bizFile ? bizFile.name : "파일 선택 (PDF, 이미지)"}
                    </p>
                    {bizFile && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setBizFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                        className="ml-auto text-gray-300 hover:text-red-400 shrink-0"><X className="w-3.5 h-3.5" /></button>
                    )}
                    <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => setBizFile(e.target.files?.[0] ?? null)} />
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 pb-5 flex gap-2 justify-end">
              {step === "found" ? (
                <button onClick={() => setModal(false)} className="px-5 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg">닫기</button>
              ) : (
                <>
                  <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
                  {(step === "new" || step === "notfound" || step === "saving") && (
                    <button onClick={handleAdd} disabled={step === "saving"}
                      className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5">
                      {step === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}등록
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 법인 탭 ──────────────────────────────────────────────────────────────────

type DealerType = "CORPORATION" | "INDIVIDUAL" | "UPPER_CORP" | "LOWER_CORP" | "SELF" | null;
type DealerModalStep = "biz" | "checking" | "found" | "form" | "saving";

const DEALER_LABELS: Record<string, string> = {
  CORPORATION: "법인", UPPER_CORP: "상위법인", SELF: "자사",
  LOWER_CORP: "하위법인", INDIVIDUAL: "개인사업자(딜러)",
};
const DEALER_COLORS: Record<string, string> = {
  CORPORATION: "bg-blue-100 text-blue-700", UPPER_CORP: "bg-indigo-100 text-indigo-700",
  SELF: "bg-purple-100 text-purple-700", LOWER_CORP: "bg-cyan-100 text-cyan-700",
  INDIVIDUAL: "bg-green-100 text-green-700",
};
const TYPE_ORDER = ["CORPORATION", "UPPER_CORP", "SELF", "LOWER_CORP", "INDIVIDUAL"];

interface DealerClient {
  id: string; clientName: string; bizNumber: string; dealerType: DealerType;
  approved: boolean; managerName?: string | null; managerPhone?: string | null;
  managerEmail?: string | null; memo?: string | null; code?: string | null;
  isSettlementTarget?: boolean | null; isRateTarget?: boolean | null;
}

function TypeBadge({ type }: { type: DealerType }) {
  if (!type) return <span className="text-xs text-gray-400 px-2 py-0.5 bg-gray-100 rounded-full">미분류</span>;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DEALER_COLORS[type] ?? "bg-gray-100 text-gray-600"}`}>
      {DEALER_LABELS[type] ?? type}
    </span>
  );
}

function TypeDropdown({ clientId, current, onUpdated }: {
  clientId: string; current: DealerType; onUpdated: (id: string, type: DealerType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  async function pick(type: DealerType) {
    setOpen(false);
    if (type === current) return;
    setSaving(true);
    const res = await fetch(`/api/dealer?id=${clientId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerType: type }),
    });
    setSaving(false);
    if (res.ok) onUpdated(clientId, type);
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} disabled={saving}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-md px-2 py-1 bg-white">
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Tag className="w-3 h-3" />}
        분류<ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[150px]">
            <button onClick={() => pick(null)} className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50">미분류</button>
            {TYPE_ORDER.map((t) => (
              <button key={t} onClick={() => pick(t as DealerType)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${current === t ? "font-bold" : ""}`}>
                {DEALER_LABELS[t]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DealersTab() {
  const [clients, setClients] = useState<DealerClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("ALL");
  const [modal, setModal] = useState(false);
  const [step, setStep] = useState<DealerModalStep>("biz");
  const [bizNumberInput, setBizNumberInput] = useState("");
  const [foundClient, setFoundClient] = useState<DealerClient | null>(null);
  const [clientName, setClientName] = useState("");
  const [dealerType, setDealerType] = useState<string>("CORPORATION");
  const [managerName, setManagerName] = useState("");
  const [managerPhone, setManagerPhone] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [memo, setMemo] = useState("");
  const [bizFile, setBizFile] = useState<File | null>(null);
  const [csoFile, setCsoFile] = useState<File | null>(null);
  const [accountFile, setAccountFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const bizRef = useRef<HTMLInputElement>(null);
  const csoRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLInputElement>(null);
  const [editModal, setEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState<DealerClient | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<string>("CORPORATION");
  const [editManagerName, setEditManagerName] = useState("");
  const [editManagerPhone, setEditManagerPhone] = useState("");
  const [editManagerEmail, setEditManagerEmail] = useState("");
  const [editMemo, setEditMemo] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [generatingCode, setGeneratingCode] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/dealer").then((r) => r.json())
      .then((d) => setClients(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openModal() {
    setStep("biz"); setBizNumberInput(""); setFoundClient(null); setClientName("");
    setDealerType("CORPORATION"); setManagerName(""); setManagerPhone(""); setManagerEmail("");
    setMemo(""); setBizFile(null); setCsoFile(null); setAccountFile(null); setFormError(null); setModal(true);
  }
  function openEdit(c: DealerClient) {
    setEditTarget(c); setEditName(c.clientName); setEditType(c.dealerType ?? "CORPORATION");
    setEditManagerName(c.managerName ?? ""); setEditManagerPhone(c.managerPhone ?? "");
    setEditManagerEmail(c.managerEmail ?? ""); setEditMemo(c.memo ?? ""); setEditError(null); setEditModal(true);
  }

  async function handleBizCheck() {
    const raw = bizNumberInput.replace(/\D/g, "");
    if (raw.length < 10) { setFormError("사업자번호 10자리를 입력해주세요."); return; }
    setFormError(null); setStep("checking");
    const res = await fetch(`/api/dealer?bizNumber=${raw}`);
    const d = await res.json();
    if (d.found) { setFoundClient(d.client); setStep("found"); }
    else setStep("form");
  }

  async function handleAdd() {
    setFormError(null);
    if (!clientName.trim()) { setFormError("거래처명을 입력해주세요."); return; }
    setStep("saving");
    try {
      const [bizDocument, csoDocument, accountDocument] = await Promise.all([
        bizFile ? fileToDataUri(bizFile) : Promise.resolve(null),
        csoFile ? fileToDataUri(csoFile) : Promise.resolve(null),
        accountFile ? fileToDataUri(accountFile) : Promise.resolve(null),
      ]);
      const res = await fetch("/api/dealer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(), bizNumber: bizNumberInput,
          dealerType: dealerType || null,
          bizDocument, bizFileName: bizFile?.name ?? null,
          csoDocument, csoFileName: csoFile?.name ?? null,
          accountDocument, accountFileName: accountFile?.name ?? null,
          managerName: managerName.trim() || null,
          managerPhone: managerPhone.trim() || null,
          managerEmail: managerEmail.trim() || null,
          memo: memo.trim() || null,
        }),
      });
      if (res.ok) { load(); setModal(false); }
      else { const d = await res.json(); setFormError(d.error ?? "등록 실패"); setStep("form"); }
    } catch { setFormError("오류가 발생했습니다."); setStep("form"); }
  }

  async function handleEditSave() {
    if (!editTarget) return;
    setEditSaving(true); setEditError(null);
    const res = await fetch(`/api/dealer?id=${editTarget.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientName: editName.trim(), dealerType: editType || null,
        managerName: editManagerName.trim() || null,
        managerPhone: editManagerPhone.trim() || null,
        managerEmail: editManagerEmail.trim() || null,
        memo: editMemo.trim() || null,
      }),
    });
    setEditSaving(false);
    if (res.ok) { load(); setEditModal(false); }
    else { const d = await res.json(); setEditError(d.error ?? "저장 실패"); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}"을(를) 삭제할까요?`)) return;
    await fetch(`/api/dealer?id=${id}`, { method: "DELETE" });
    setClients((p) => p.filter((c) => c.id !== id));
  }

  async function generateCode(id: string) {
    setGeneratingCode(id);
    try {
      const res = await fetch("/api/generate-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "dealer", id }),
      });
      const data = await res.json();
      if (data.code) setClients((p) => p.map((c) => c.id === id ? { ...c, code: data.code } : c));
    } finally { setGeneratingCode(null); }
  }

  const filtered = clients.filter((c) => {
    const matchQ = !query || c.clientName.includes(query) || c.bizNumber.includes(query);
    const matchT = filterType === "ALL" || c.dealerType === filterType;
    return matchQ && matchT;
  });

  function FieldRow({ label, value, onChange, placeholder, type = "text" }: {
    label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
  }) {
    return (
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-600">{label}</label>
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
    );
  }

  function FileRow({ label, file, onChange, inputRef }: {
    label: string; file: File | null; onChange: (f: File | null) => void; inputRef: React.RefObject<HTMLInputElement | null>;
  }) {
    return (
      <div onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2.5 border border-dashed border-gray-300 rounded-lg px-3 py-2.5 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30">
        <Upload className="w-4 h-4 text-gray-400 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-gray-500 leading-tight">{label}</p>
          <p className={`text-xs truncate mt-0.5 ${file ? "text-blue-600 font-medium" : "text-gray-400"}`}>
            {file ? file.name : "파일 선택 (PDF, 이미지)"}
          </p>
        </div>
        {file && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onChange(null); if (inputRef.current) inputRef.current.value = ""; }}
            className="ml-auto text-gray-300 hover:text-red-400 shrink-0"><X className="w-3.5 h-3.5" /></button>
        )}
        <input ref={inputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input placeholder="거래처명 또는 사업자번호 검색" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9 text-sm" />
        </div>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="ALL">전체 유형</option>
          {TYPE_ORDER.map((t) => <option key={t} value={t}>{DEALER_LABELS[t]}</option>)}
        </select>
        <button onClick={openModal}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" />법인 추가
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
          {query || filterType !== "ALL" ? "검색 결과가 없습니다" : "등록된 법인이 없습니다"}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] text-xs font-semibold text-gray-500 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            <span>거래처명</span>
            <span className="text-center w-28">사업자번호</span>
            <span className="text-center w-24">유형</span>
            <span className="text-center w-24">코드</span>
            <span className="text-center w-16">분류</span>
            <span className="w-20" />
          </div>
          <div className="divide-y divide-gray-50">
            {filtered.map((c) => (
              <div key={c.id} className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{c.clientName}</p>
                    {c.managerName && <p className="text-xs text-gray-400">{c.managerName}</p>}
                  </div>
                </div>
                <span className="text-sm text-gray-500 w-28 text-center font-mono">{formatBiz(c.bizNumber)}</span>
                <div className="w-24 flex justify-center"><TypeBadge type={c.dealerType} /></div>
                <div className="w-24 flex justify-center">
                  {c.code ? (
                    <span className="inline-flex items-center gap-1 text-xs font-mono bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                      <Hash className="w-3 h-3" />{c.code}
                    </span>
                  ) : (
                    <button onClick={() => generateCode(c.id)} disabled={generatingCode === c.id}
                      className="flex items-center gap-1 text-xs px-2 py-0.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                      {generatingCode === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hash className="w-3 h-3" />}
                      코드생성
                    </button>
                  )}
                </div>
                <div className="w-16 flex justify-center">
                  <TypeDropdown clientId={c.id} current={c.dealerType}
                    onUpdated={(id, type) => setClients((p) => p.map((cl) => cl.id === id ? { ...cl, dealerType: type } : cl))} />
                </div>
                <div className="w-20 flex justify-end items-center gap-1">
                  <button onClick={() => openEdit(c)} className="text-gray-300 hover:text-blue-500 transition-colors"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(c.id, c.clientName)} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-gray-400 text-right">총 {filtered.length}개{(query || filterType !== "ALL") && ` (전체 ${clients.length}개 중)`}</p>

      {/* 등록 모달 */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-semibold text-gray-900">법인 등록</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {step === "biz" && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-600">사업자번호로 조회 *</label>
                    <div className="flex gap-2">
                      <Input value={bizNumberInput} onChange={(e) => setBizNumberInput(formatBizNum(e.target.value))}
                        placeholder="000-00-00000" maxLength={12} className="flex-1" onKeyDown={(e) => e.key === "Enter" && handleBizCheck()} />
                      <button onClick={handleBizCheck} className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">조회</button>
                    </div>
                    {formError && <p className="text-xs text-red-600">{formError}</p>}
                  </div>
                </div>
              )}
              {step === "checking" && (
                <div className="flex items-center justify-center py-6 gap-2 text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">조회 중...</span>
                </div>
              )}
              {step === "found" && foundClient && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-amber-800">이미 등록된 사업자번호입니다</p>
                      <p className="text-xs text-amber-700 mt-0.5">{foundClient.clientName} ({formatBiz(foundClient.bizNumber)})</p>
                    </div>
                  </div>
                </div>
              )}
              {step === "form" && (
                <div className="space-y-3">
                  <FieldRow label="거래처명 *" value={clientName} onChange={setClientName} placeholder="상호명" />
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-600">법인 유형</label>
                    <select value={dealerType} onChange={(e) => setDealerType(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {TYPE_ORDER.map((t) => <option key={t} value={t}>{DEALER_LABELS[t]}</option>)}
                    </select>
                  </div>
                  <FieldRow label="담당자명" value={managerName} onChange={setManagerName} placeholder="홍길동" />
                  <FieldRow label="담당자 연락처" value={managerPhone} onChange={setManagerPhone} placeholder="010-0000-0000" />
                  <FieldRow label="담당자 이메일" value={managerEmail} onChange={setManagerEmail} placeholder="email@example.com" type="email" />
                  <FieldRow label="메모" value={memo} onChange={setMemo} placeholder="비고" />
                  <FileRow label="사업자등록증" file={bizFile} onChange={setBizFile} inputRef={bizRef} />
                  <FileRow label="CSO 계약서" file={csoFile} onChange={setCsoFile} inputRef={csoRef} />
                  <FileRow label="정산 계좌 서류" file={accountFile} onChange={setAccountFile} inputRef={accountRef} />
                  {formError && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{formError}</p>}
                </div>
              )}
            </div>
            <div className="px-6 pb-5 flex gap-2 justify-end sticky bottom-0 bg-white border-t pt-4">
              {step === "found" ? (
                <button onClick={() => setModal(false)} className="px-5 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg">닫기</button>
              ) : step === "form" ? (
                <>
                  <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
                  <button onClick={handleAdd}
                    className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-1.5">
                    등록
                  </button>
                </>
              ) : step === "biz" ? (
                <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* 수정 모달 */}
      {editModal && editTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="font-semibold text-gray-900">법인 수정</h2>
              <button onClick={() => setEditModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">거래처명 *</label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">법인 유형</label>
                <select value={editType} onChange={(e) => setEditType(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {TYPE_ORDER.map((t) => <option key={t} value={t}>{DEALER_LABELS[t]}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">담당자명</label>
                <Input value={editManagerName} onChange={(e) => setEditManagerName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">담당자 연락처</label>
                <Input value={editManagerPhone} onChange={(e) => setEditManagerPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">담당자 이메일</label>
                <Input value={editManagerEmail} onChange={(e) => setEditManagerEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">메모</label>
                <Input value={editMemo} onChange={(e) => setEditMemo(e.target.value)} />
              </div>
              {editError && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{editError}</p>}
            </div>
            <div className="px-6 pb-5 flex gap-2 justify-end sticky bottom-0 bg-white border-t pt-4">
              <button onClick={() => setEditModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={handleEditSave} disabled={editSaving}
                className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5">
                {editSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 영업사원 탭 ──────────────────────────────────────────────────────────────

interface SalesRep {
  id: string; name: string | null; email: string; phone: string | null;
  approved: boolean; salesCode: string | null; createdAt: string;
}
interface BulkRow { name: string; email: string; phone: string; password: string; bizNumbersText: string; }
interface BulkResult {
  row: number; status: "ok" | "error"; createdNew?: boolean; email?: string; salesCode?: string;
  mappedClients?: number; unmappedBizNumbers?: string[]; error?: string;
}

const TEMPLATE_HEADER = "이름\t이메일\t휴대폰\t임시비밀번호\t사업자번호(콤마구분)";
const TEMPLATE_EXAMPLE = "김딜러\tdealer1@kmd.com\t010-1111-1111\tabc12345\t2110948285,1234567890";

function parsePastedData(text: string): BulkRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("이름\t") && !l.startsWith("# "));
  return lines.map((line) => {
    const cols = line.includes("\t") ? line.split("\t") : line.split(/,(?![^"]*")/);
    const [name = "", email = "", phone = "", password = "", bizNumbersText = ""] = cols.map((c) => c.trim());
    return { name, email, phone, password, bizNumbersText };
  });
}
function isValidEmail(s: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function parseBizNumbers(text: string): string[] {
  return Array.from(new Set(text.split(/[,\s/;]+/).map((s) => s.replace(/[^0-9]/g, "")).filter((b) => b.length >= 9 && b.length <= 12)));
}

function SalesRepsTab() {
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [generating, setGenerating] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null);

  const load = useCallback(async (q = "") => {
    setLoading(true);
    const res = await fetch(`/api/sales-reps?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setReps(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setTimeout(() => load(search), 300); return () => clearTimeout(t); }, [search, load]);

  async function toggleApproved(rep: SalesRep) {
    const res = await fetch("/api/sales-reps", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rep.id, approved: !rep.approved }),
    });
    if (res.ok) { const updated = await res.json(); setReps((p) => p.map((r) => r.id === rep.id ? { ...r, approved: updated.approved } : r)); }
  }

  async function generateCode(rep: SalesRep) {
    setGenerating(rep.id);
    try {
      const res = await fetch("/api/generate-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "sales", id: rep.id }),
      });
      const data = await res.json();
      if (res.ok) setReps((p) => p.map((r) => r.id === rep.id ? { ...r, salesCode: data.code } : r));
      else if (data.code) setReps((p) => p.map((r) => r.id === rep.id ? { ...r, salesCode: data.code } : r));
      else alert(data.error ?? "코드 생성 실패");
    } finally { setGenerating(null); }
  }

  const parsedRows = useMemo(() => parsePastedData(bulkText), [bulkText]);
  const validation = useMemo(() => {
    const seenEmails = new Set<string>();
    return parsedRows.map((r) => {
      const issues: string[] = [];
      if (!r.name) issues.push("이름");
      if (!r.email) issues.push("이메일");
      else if (!isValidEmail(r.email)) issues.push("이메일 형식");
      else if (seenEmails.has(r.email.toLowerCase())) issues.push("입력 내 이메일 중복");
      if (r.email) seenEmails.add(r.email.toLowerCase());
      if (!r.password) issues.push("비밀번호");
      else if (r.password.length < 4) issues.push("비밀번호 4자↑");
      const biz = parseBizNumbers(r.bizNumbersText);
      return { row: r, issues, bizNumbers: biz };
    });
  }, [parsedRows]);
  const okCount = validation.filter((v) => v.issues.length === 0).length;

  function copyTemplate() {
    navigator.clipboard.writeText(`${TEMPLATE_HEADER}\n${TEMPLATE_EXAMPLE}`);
    alert("양식이 클립보드에 복사되었습니다.");
  }

  async function submitBulk() {
    const okRows = validation.filter((v) => v.issues.length === 0).map((v) => ({
      name: v.row.name, email: v.row.email, phone: v.row.phone || undefined,
      password: v.row.password, bizNumbers: v.bizNumbers,
    }));
    if (okRows.length === 0) { alert("유효한 행이 없습니다."); return; }
    if (!confirm(`${okRows.length}명을 일괄 등록합니다. 진행할까요?`)) return;
    setBulkSubmitting(true);
    try {
      const res = await fetch("/api/sales-reps/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: okRows }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "등록 실패"); return; }
      setBulkResults(data.results); await load();
    } finally { setBulkSubmitting(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="이름, 이메일, 코드 검색"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => { setBulkText(""); setBulkResults(null); setBulkOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg">
            <Upload className="w-4 h-4" />대량등록
          </button>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 px-3 py-2 rounded-lg">
            <Users className="w-3.5 h-3.5" />총 {reps.length}명
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : reps.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">{search ? "검색 결과가 없어요." : "등록된 영업사원이 없어요."}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {["이름", "이메일", "연락처", "영업사원 코드", "승인", "가입일"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {reps.map((rep) => (
                  <tr key={rep.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{rep.name ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{rep.email}</td>
                    <td className="px-4 py-3 text-gray-600">{rep.phone ?? "-"}</td>
                    <td className="px-4 py-3">
                      {rep.salesCode ? (
                        <span className="inline-flex items-center gap-1 text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                          <Hash className="w-3 h-3" />{rep.salesCode}
                        </span>
                      ) : (
                        <button onClick={() => generateCode(rep)} disabled={generating === rep.id}
                          className="flex items-center gap-1 text-xs px-2.5 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                          {generating === rep.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hash className="w-3 h-3" />}코드 생성
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleApproved(rep)}
                        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                          rep.approved ? "bg-green-50 text-green-700 hover:bg-green-100" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}>
                        {rep.approved ? <><CheckCircle className="w-3 h-3" />승인</> : <><XCircle className="w-3 h-3" />미승인</>}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{new Date(rep.createdAt).toLocaleDateString("ko-KR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {bulkOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setBulkOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Upload className="w-5 h-5 text-amber-600" />영업사원 대량 등록
              </h2>
              <button onClick={() => setBulkOpen(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            {bulkResults ? (
              <div className="p-6 space-y-4">
                <div className="bg-gray-50 rounded-lg p-4 text-sm">
                  <div className="font-semibold mb-1">등록 결과</div>
                  <div className="text-gray-600">
                    총 {bulkResults.length}명 중{" "}
                    <span className="text-green-700 font-semibold">{bulkResults.filter((r) => r.status === "ok" && r.createdNew).length}명 신규</span>{" / "}
                    <span className="text-blue-700 font-semibold">{bulkResults.filter((r) => r.status === "ok" && !r.createdNew).length}명 매핑추가</span>{" / "}
                    <span className="text-red-700 font-semibold">{bulkResults.filter((r) => r.status === "error").length}명 실패</span>
                  </div>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        {["#", "이메일", "결과", "상세"].map((h) => (
                          <th key={h} className="px-3 py-2 text-left text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bulkResults.map((r) => (
                        <tr key={r.row}>
                          <td className="px-3 py-2 text-gray-400">{r.row + 1}</td>
                          <td className="px-3 py-2 font-mono">{r.email}</td>
                          <td className="px-3 py-2">
                            {r.status === "ok" ? (r.createdNew ? <span className="text-green-700">✨ 신규</span> : <span className="text-blue-700">🔗 매핑추가</span>) : <span className="text-red-700">❌ {r.error}</span>}
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {r.status === "ok" && (
                              <>
                                {r.salesCode} · 거래처 {r.mappedClients}개 매핑
                                {r.unmappedBizNumbers && r.unmappedBizNumbers.length > 0 && (
                                  <span className="ml-2 text-amber-600">⚠ 미등록: {r.unmappedBizNumbers.join(", ")}</span>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setBulkResults(null); setBulkText(""); }}
                    className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">또 등록하기</button>
                  <button onClick={() => setBulkOpen(false)} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">닫기</button>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-5">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 space-y-1">
                  <div className="font-semibold">📋 양식 (탭 또는 콤마 구분)</div>
                  <div>이름 / 이메일 / 휴대폰 / 임시비밀번호 / 사업자번호(콤마 구분으로 여러 개)</div>
                  <button onClick={copyTemplate} className="mt-1 inline-flex items-center gap-1 px-2 py-1 bg-white border border-blue-300 rounded text-blue-700 hover:bg-blue-50">
                    <FileSpreadsheet className="w-3.5 h-3.5" />양식 클립보드 복사
                  </button>
                  <div className="text-[11px] text-blue-700 mt-1 space-y-0.5">
                    <div>💡 엑셀에서 작성 후 행 통째로 복사 → 아래 칸에 붙여넣으세요. 첫 헤더 행은 자동 무시.</div>
                    <div>💡 <b>이미 가입된 이메일</b>은 신규 생성 X — 거래처 매핑만 추가됩니다.</div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">데이터 입력</label>
                  <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)}
                    placeholder={`김딜러\tdealer1@kmd.com\t010-1111-1111\tabc12345\t2110948285,1234567890`}
                    rows={8} className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y" />
                </div>
                {parsedRows.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-gray-700">미리보기 ({parsedRows.length}행)</label>
                      <span className="text-xs">
                        <span className="text-green-700 font-semibold">{okCount}명</span>
                        <span className="text-gray-400"> / {parsedRows.length}명 등록 가능</span>
                      </span>
                    </div>
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            {["#", "이름", "이메일", "휴대폰", "PW", "거래처", "상태"].map((h) => (
                              <th key={h} className="px-2 py-2 text-left text-gray-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {validation.map((v, i) => (
                            <tr key={i} className={v.issues.length === 0 ? "" : "bg-red-50"}>
                              <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                              <td className="px-2 py-1.5">{v.row.name || "—"}</td>
                              <td className="px-2 py-1.5 font-mono">{v.row.email || "—"}</td>
                              <td className="px-2 py-1.5">{v.row.phone || "—"}</td>
                              <td className="px-2 py-1.5">{v.row.password ? "•".repeat(Math.min(v.row.password.length, 8)) : "—"}</td>
                              <td className="px-2 py-1.5">{v.bizNumbers.length}개</td>
                              <td className="px-2 py-1.5">
                                {v.issues.length === 0
                                  ? <span className="text-green-700 inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" />OK</span>
                                  : <span className="text-red-700 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{v.issues.join(", ")}</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
            {!bulkResults && (
              <div className="flex justify-end gap-2 px-6 pb-5 sticky bottom-0 bg-white border-t pt-4">
                <button onClick={() => setBulkOpen(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
                <button onClick={submitBulk} disabled={okCount === 0 || bulkSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg disabled:opacity-40">
                  {bulkSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <Plus className="w-4 h-4" />{okCount}명 일괄 생성
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

type Tab = "clients" | "dealers" | "sales-reps";

const TABS: { key: Tab; label: string; icon: React.ElementType; desc: string }[] = [
  { key: "clients",    label: "병·의원",   icon: Hospital,   desc: "병의원 등록·승인·H-코드 생성" },
  { key: "dealers",    label: "법인",      icon: Building2,  desc: "법인·딜러 계층 등록·C-코드 생성" },
  { key: "sales-reps", label: "영업사원",  icon: UserCheck,  desc: "영업사원 승인·S-코드 생성" },
];

function UsersPageInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    return (t === "dealers" || t === "sales-reps") ? t : "clients";
  });

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role;
    if (role !== "BIZ" && role !== "ADMIN") router.push("/");
  }, [session, status, router]);

  function switchTab(t: Tab) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
  }

  const current = TABS.find((t) => t.key === tab)!;

  return (
    <BizLayout>
      <div className="space-y-5">
        {/* 헤더 */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">유저 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">{current.desc}</p>
        </div>

        {/* 탭 바 */}
        <div className="flex border-b border-gray-200">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => switchTab(t.key)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  active
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}>
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* 탭 콘텐츠 */}
        {tab === "clients"    && <ClientsTab />}
        {tab === "dealers"    && <DealersTab />}
        {tab === "sales-reps" && <SalesRepsTab />}
      </div>
    </BizLayout>
  );
}

export default function UsersPage() {
  return (
    <Suspense>
      <UsersPageInner />
    </Suspense>
  );
}
