"use client";

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Hospital, Building2, UserCheck, Search, Plus, Trash2, Loader2, Upload, Download,
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

function DealersTab({ fixedType }: { fixedType?: string } = {}) {
  const [clients, setClients] = useState<DealerClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("ALL");
  const [modal, setModal] = useState(false);
  const [step, setStep] = useState<DealerModalStep>("biz");
  const [bizNumberInput, setBizNumberInput] = useState("");
  const [foundClient, setFoundClient] = useState<DealerClient | null>(null);
  const [clientName, setClientName] = useState("");
  const [dealerType, setDealerType] = useState<string>(fixedType ?? "CORPORATION");
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
    setDealerType(fixedType ?? "CORPORATION"); setManagerName(""); setManagerPhone(""); setManagerEmail("");
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
    if (fixedType !== undefined && c.dealerType !== fixedType) return false;
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
        {fixedType === undefined && (
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="ALL">전체 유형</option>
            {TYPE_ORDER.map((t) => <option key={t} value={t}>{DEALER_LABELS[t]}</option>)}
          </select>
        )}
        <button onClick={openModal}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" />법인 추가
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
          {query || (fixedType === undefined && filterType !== "ALL") ? "검색 결과가 없습니다" : `등록된 ${fixedType ? (DEALER_LABELS[fixedType] ?? "법인") : "법인"}이 없습니다`}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] text-xs font-semibold text-gray-500 px-4 py-2.5 bg-gray-50 border-b border-gray-100 rounded-t-xl">
            <span>거래처명</span>
            <span className="text-center w-28">사업자번호</span>
            <span className="text-center w-24">유형</span>
            <span className="text-center w-24">코드</span>
            <span className="text-center w-16">분류</span>
            <span className="text-center w-16">정산</span>
            <span className="w-20" />
          </div>
          <div className="divide-y divide-gray-50">
            {filtered.map((c) => (
              <div key={c.id} className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] items-center px-4 py-3">
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
                <div className="w-16 flex justify-center">
                  <button
                    onClick={async () => {
                      const next = !c.isSettlementTarget;
                      await fetch(`/api/dealer?id=${c.id}`, {
                        method: "PATCH", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ isSettlementTarget: next }),
                      });
                      setClients((p) => p.map((cl) => cl.id === c.id ? { ...cl, isSettlementTarget: next } : cl));
                    }}
                    title={c.isSettlementTarget ? "정산 대상 (클릭시 해제)" : "정산 미대상 (클릭시 설정)"}
                    className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                      c.isSettlementTarget
                        ? "bg-green-100 text-green-700 hover:bg-green-200"
                        : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                    }`}>
                    {c.isSettlementTarget ? "정산 ON" : "OFF"}
                  </button>
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
      <p className="text-xs text-gray-400 text-right">총 {filtered.length}개{(query || (fixedType === undefined && filterType !== "ALL")) && ` (전체 ${fixedType !== undefined ? clients.filter((c) => c.dealerType === fixedType).length : clients.length}개 중)`}</p>

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

// ─── 원내 병·의원 탭 ──────────────────────────────────────────────────────────

interface InhouseKmdUser {
  id: string;
  email: string;
  name: string | null;
  role?: string;
}

interface InhouseAccount {
  id: string;
  bizNumber: string;
  clientName: string;
  loginId: string;
  active: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  memo: string | null;
  kmdUserId: string | null;
  kmdUser: InhouseKmdUser | null;
  createdAt: string;
  updatedAt: string;
}

interface InhouseKmdClient {
  bizNumber: string;
  clientName: string;
}

interface InhouseBulkResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

interface InhouseBulkPreviewRow {
  bizNumber: string;
  clientName: string;
  loginId: string;
  loginPw: string;
  kmdEmail: string;
  memo: string;
  kmdUserEmail: string;
}

const INHOUSE_EMPTY = {
  bizNumber: "",
  clientName: "",
  loginId: "",
  loginPw: "",
  memo: "",
  kmdUserId: "" as string,
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function InhouseStatusBadge({ status, error }: { status: string | null; error: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">미실행</span>;
  if (status === "ok")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700">
        <CheckCircle2 className="w-3.5 h-3.5" /> 성공
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-700" title={error ?? ""}>
      <AlertCircle className="w-3.5 h-3.5" /> 실패
    </span>
  );
}

function isInhouseIncomplete(a: InhouseAccount): boolean {
  if (!a.kmdUserId) return true;
  if (!a.lastSyncedAt) return true;
  if (a.lastSyncStatus === "error") return true;
  return false;
}

function inhouseMissingFields(a: InhouseAccount): string[] {
  const m: string[] = [];
  if (!a.kmdUserId) m.push("KMD 아이디");
  if (!a.lastSyncedAt) m.push("최근 sync");
  if (a.lastSyncStatus === "error") m.push("sync 실패");
  return m;
}

function InhouseClientsTab() {
  const [items, setItems] = useState<InhouseAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "incomplete">("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [total, setTotal] = useState(0);
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [edit, setEdit] = useState<InhouseAccount | null>(null);
  const [form, setForm] = useState(INHOUSE_EMPTY);
  const [saving, setSaving] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const [kmdClients, setKmdClients] = useState<InhouseKmdClient[]>([]);
  const [kmdSearch, setKmdSearch] = useState("");
  const [kmdOpen, setKmdOpen] = useState(false);
  const kmdRef = useRef<HTMLDivElement>(null);

  const [kmdUsers, setKmdUsers] = useState<InhouseKmdUser[]>([]);
  const [kmdUserSearch, setKmdUserSearch] = useState("");
  const [kmdUserOpen, setKmdUserOpen] = useState(false);
  const [selectedKmdUser, setSelectedKmdUser] = useState<InhouseKmdUser | null>(null);
  const kmdUserRef = useRef<HTMLDivElement>(null);

  const [bulkModal, setBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkPreview, setBulkPreview] = useState<InhouseBulkPreviewRow[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResult, setBulkResult] = useState<InhouseBulkResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const r = await fetch(`/api/epharms-accounts?${params.toString()}`);
      if (r.ok) {
        const body = await r.json();
        if (Array.isArray(body)) {
          setItems(body);
          setTotal(body.length);
        } else {
          setItems(body.items ?? []);
          setTotal(body.total ?? 0);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [search, page, limit]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, limit]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (kmdRef.current && !kmdRef.current.contains(e.target as Node)) {
        setKmdOpen(false);
      }
      if (kmdUserRef.current && !kmdUserRef.current.contains(e.target as Node)) {
        setKmdUserOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  async function fetchKmdClients() {
    try {
      const r = await fetch("/api/epharms-accounts/clients");
      if (r.ok) {
        const data = await r.json();
        setKmdClients(data.items ?? []);
      }
    } catch {
      setKmdClients([]);
    }
  }

  const kmdUserSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!kmdUserOpen) return;
    if (kmdUserSearchTimer.current) clearTimeout(kmdUserSearchTimer.current);
    kmdUserSearchTimer.current = setTimeout(async () => {
      try {
        const url = `/api/epharms-accounts/users${kmdUserSearch ? `?q=${encodeURIComponent(kmdUserSearch)}` : ""}`;
        const r = await fetch(url);
        if (r.ok) {
          const data = await r.json();
          setKmdUsers(data.items ?? []);
        }
      } catch {
        setKmdUsers([]);
      }
    }, 200);
    return () => {
      if (kmdUserSearchTimer.current) clearTimeout(kmdUserSearchTimer.current);
    };
  }, [kmdUserSearch, kmdUserOpen]);

  function selectKmdUser(u: InhouseKmdUser) {
    setSelectedKmdUser(u);
    setForm((prev) => ({ ...prev, kmdUserId: u.id }));
    setKmdUserSearch(u.email);
    setKmdUserOpen(false);
  }

  function clearKmdUser() {
    setSelectedKmdUser(null);
    setForm((prev) => ({ ...prev, kmdUserId: "" }));
    setKmdUserSearch("");
  }

  function openAdd() {
    setForm(INHOUSE_EMPTY);
    setEdit(null);
    setKmdSearch("");
    setKmdOpen(false);
    setKmdUserSearch("");
    setKmdUserOpen(false);
    setSelectedKmdUser(null);
    setModal("add");
    fetchKmdClients();
  }

  function openEdit(a: InhouseAccount) {
    setEdit(a);
    setForm({
      bizNumber: a.bizNumber,
      clientName: a.clientName,
      loginId: a.loginId,
      loginPw: "",
      memo: a.memo ?? "",
      kmdUserId: a.kmdUserId ?? "",
    });
    setSelectedKmdUser(a.kmdUser ?? null);
    setKmdUserSearch(a.kmdUser?.email ?? "");
    setKmdUserOpen(false);
    setModal("edit");
  }

  function selectKmdClient(c: InhouseKmdClient) {
    setForm((prev) => ({ ...prev, bizNumber: c.bizNumber, clientName: c.clientName }));
    setKmdSearch(c.clientName);
    setKmdOpen(false);
  }

  const filteredKmd = kmdClients.filter(
    (c) => c.clientName.includes(kmdSearch) || c.bizNumber.includes(kmdSearch)
  );

  async function handleSave() {
    setSaving(true);
    try {
      const isEdit = modal === "edit" && edit;
      const r = await fetch("/api/epharms-accounts", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? {
                id: edit!.id,
                clientName: form.clientName,
                loginId: form.loginId,
                ...(form.loginPw ? { loginPw: form.loginPw } : {}),
                memo: form.memo,
                kmdUserId: form.kmdUserId || null,
              }
            : {
                bizNumber: form.bizNumber.replace(/[^0-9]/g, ""),
                clientName: form.clientName,
                loginId: form.loginId,
                loginPw: form.loginPw,
                memo: form.memo,
                kmdUserId: form.kmdUserId || null,
              }
        ),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        alert((e as { error?: string }).error || "저장 실패");
        return;
      }
      setModal(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(a: InhouseAccount) {
    await fetch("/api/epharms-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, active: !a.active }),
    });
    await load();
  }

  async function handleDelete(a: InhouseAccount) {
    if (!confirm(`${a.clientName} 계정을 삭제하시겠습니까?\n저장된 매출원장 데이터도 모두 삭제됩니다.`)) return;
    await fetch(`/api/epharms-accounts?id=${a.id}`, { method: "DELETE" });
    await load();
  }

  async function syncAll() {
    if (!confirm("지금 전체 활성 계정의 매출원장을 다시 긁어옵니다. (수십분 소요 가능)\n진행할까요?")) return;
    setSyncingAll(true);
    try {
      const r = await fetch("/api/epharms-accounts/sync", { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) alert((body as { error?: string }).error || "워커 호출 실패");
      else alert("백그라운드 sync 시작됨. 잠시 후 새로고침으로 결과 확인하세요.");
    } finally {
      setSyncingAll(false);
    }
  }

  async function syncOne(a: InhouseAccount) {
    setSyncingId(a.id);
    try {
      const r = await fetch(`/api/epharms-accounts/sync?accountId=${a.id}`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) alert((body as { error?: string }).error || "워커 호출 실패");
      else alert(`${a.clientName} sync 시작됨. 30초~1분 후 새로고침해보세요.`);
    } finally {
      setSyncingId(null);
    }
  }

  function openBulkModal() {
    setBulkFile(null);
    setBulkPreview([]);
    setBulkResult(null);
    setBulkSubmitting(false);
    setBulkModal(true);
  }

  async function handleBulkFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFile(file);
    setBulkResult(null);
    try {
      const { read, utils } = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = read(new Uint8Array(buffer), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const preview: InhouseBulkPreviewRow[] = rows.slice(0, 10).map((r) => ({
        bizNumber: String(r["사업자번호"] ?? "").replace(/[^0-9]/g, ""),
        clientName: String(r["거래처명"] ?? "").trim(),
        loginId: String(r["이팜스ID"] ?? "").trim(),
        loginPw: String(r["이팜스PW"] ?? "").trim(),
        kmdEmail: String(r["KMD아이디"] ?? "").trim(),
        memo: String(r["메모"] ?? "").trim(),
        kmdUserEmail: String(r["KMD아이디(이메일)"] ?? r["KMD아이디"] ?? "").trim(),
      }));
      setBulkPreview(preview);
    } catch {
      setBulkPreview([]);
    }
  }

  async function handleTemplateDownload() {
    const { utils, writeFile } = await import("xlsx");
    const ws = utils.aoa_to_sheet([
      ["사업자번호", "거래처명", "이팜스ID", "이팜스PW", "담당자코드", "메모", "KMD아이디(이메일)"],
      ["1234567890", "○○의원", "epharms_id", "epharms_pw", "S-0001", "", "user@example.com"],
    ]);
    ws["!cols"] = [{ wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 26 }];
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "계정목록");
    writeFile(wb, "epharms_accounts_template.xlsx");
  }

  async function handleBulkSubmit() {
    if (!bulkFile) return;
    setBulkSubmitting(true);
    setBulkResult(null);
    try {
      const fd = new FormData();
      fd.append("file", bulkFile);
      const r = await fetch("/api/epharms-accounts/bulk", { method: "POST", body: fd });
      const data: InhouseBulkResult = await r.json().catch(() => ({ created: 0, updated: 0, skipped: 0, errors: ["응답 파싱 실패"] }));
      if (!r.ok) {
        setBulkResult({ created: 0, updated: 0, skipped: 0, errors: [(data as { error?: string }).error ?? "업로드 실패"] });
        return;
      }
      setBulkResult(data);
      if (data.created > 0 || data.updated > 0) {
        await load();
      }
    } finally {
      setBulkSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 상단 액션 바 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-500">
          거래처별 yk.ep45.co.kr 로그인 계정 등록 → 매일 00:00(KST) 자동 sync
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={syncAll}
            disabled={syncingAll}
            className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {syncingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            지금 전체 sync
          </button>
          <button
            onClick={openBulkModal}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg"
          >
            <Upload className="w-4 h-4" /> 엑셀 일괄등록
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
          >
            <Plus className="w-4 h-4" /> 계정 추가
          </button>
        </div>
      </div>

      {/* 검색 + 새로고침 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="거래처명 / 사업자번호 / 로그인ID 검색"
            className="pl-9 text-sm"
          />
        </div>
        <button onClick={load} className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
          새로고침
        </button>
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={() => setFilterMode("all")}
          className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
            filterMode === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          전체 ({items.length})
        </button>
        <button
          onClick={() => setFilterMode("incomplete")}
          className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
            filterMode === "incomplete"
              ? "bg-red-600 text-white"
              : items.filter(isInhouseIncomplete).length > 0
                ? "bg-red-50 text-red-700 hover:bg-red-100"
                : "bg-gray-100 text-gray-400"
          }`}
          title="KMD 아이디 미연결 / sync 미실행 / sync 실패 중 하나라도 있는 계정"
        >
          정보 누락 ({items.filter(isInhouseIncomplete).length})
        </button>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">거래처</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">사업자번호</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">ePharms ID</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">KMD 아이디</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">최근 sync</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">상태</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">활성</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> 불러오는 중…
              </td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                등록된 계정이 없습니다. "계정 추가" 버튼으로 시작하세요.
              </td></tr>
            )}
            {!loading && items.length > 0 && (filterMode === "incomplete"
              ? items.filter(isInhouseIncomplete)
              : items
            ).length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                필터에 해당하는 계정이 없습니다.
              </td></tr>
            )}
            {(filterMode === "incomplete" ? items.filter(isInhouseIncomplete) : items).map((a) => {
              const missing = inhouseMissingFields(a);
              return (
                <tr key={a.id} className={a.active ? "" : "bg-gray-50 opacity-60"}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    <div>{a.clientName}</div>
                    {missing.length > 0 && (
                      <div className="text-[11px] text-red-500 mt-0.5">누락: {missing.join(", ")}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 font-mono">{a.bizNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 font-mono">{a.loginId}</td>
                  <td className="px-4 py-3 text-xs">
                    {a.kmdUser ? (
                      <div className="flex flex-col">
                        <span className="font-mono text-gray-700">{a.kmdUser.email}</span>
                        {a.kmdUser.name && <span className="text-[11px] text-gray-400">{a.kmdUser.name}</span>}
                      </div>
                    ) : (
                      <span className="text-gray-300">미연결</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(a.lastSyncedAt)}</td>
                  <td className="px-4 py-3"><InhouseStatusBadge status={a.lastSyncStatus} error={a.lastSyncError} /></td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggle(a)} title={a.active ? "비활성화" : "활성화"}>
                      {a.active
                        ? <ToggleRight className="w-6 h-6 text-blue-600" />
                        : <ToggleLeft className="w-6 h-6 text-gray-400" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => syncOne(a)}
                        disabled={syncingId === a.id || !a.active}
                        className="p-1.5 text-orange-600 hover:bg-orange-50 rounded disabled:opacity-30"
                        title="이 계정만 지금 sync"
                      >
                        {syncingId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      </button>
                      <button onClick={() => openEdit(a)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded" title="수정">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(a)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="삭제">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between text-sm">
          <div className="text-xs text-gray-500">
            총 <span className="font-semibold text-gray-700">{total.toLocaleString()}</span>개 중{" "}
            <span className="font-semibold text-gray-700">{(page - 1) * limit + 1}</span>–
            <span className="font-semibold text-gray-700">{Math.min(page * limit, total)}</span> 표시
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="text-xs border border-gray-200 rounded px-2 py-1.5"
              title="페이지당 갯수"
            >
              {[20, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n}개씩</option>
              ))}
            </select>
            <button onClick={() => setPage(1)} disabled={page <= 1}
              className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30 hover:bg-gray-50">«</button>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30 hover:bg-gray-50">이전</button>
            <span className="text-xs text-gray-600 px-2">
              <span className="font-semibold text-gray-900">{page}</span> / {totalPages}
            </span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30 hover:bg-gray-50">다음</button>
            <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}
              className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30 hover:bg-gray-50">»</button>
          </div>
        </div>
      )}

      {/* Add / Edit 모달 */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setModal(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-blue-600" />
                {modal === "add" ? "ePharms 계정 추가" : "ePharms 계정 수정"}
              </h2>
              <button onClick={() => setModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              {modal === "add" && (
                <div ref={kmdRef} className="relative">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    KMD 거래처 선택 (선택시 자동입력)
                  </label>
                  <input
                    value={kmdSearch}
                    onChange={(e) => { setKmdSearch(e.target.value); setKmdOpen(true); }}
                    onFocus={() => setKmdOpen(true)}
                    placeholder="거래처명 또는 사업자번호 검색…"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {kmdOpen && filteredKmd.length > 0 && (
                    <ul className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                      {filteredKmd.map((c) => (
                        <li
                          key={c.bizNumber}
                          onMouseDown={() => selectKmdClient(c)}
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 flex items-center justify-between"
                        >
                          <span className="font-medium text-gray-800">{c.clientName}</span>
                          <span className="text-xs text-gray-400 font-mono">{c.bizNumber}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {kmdOpen && kmdSearch.length > 0 && filteredKmd.length === 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-lg text-sm text-gray-400">
                      검색 결과 없음
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">사업자번호 *</label>
                <input
                  value={form.bizNumber}
                  onChange={(e) => setForm({ ...form, bizNumber: e.target.value })}
                  disabled={modal === "edit"}
                  placeholder="숫자만 (예: 2110948285)"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">거래처명 *</label>
                <input
                  value={form.clientName}
                  onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">ePharms 로그인 ID *</label>
                <input
                  value={form.loginId}
                  onChange={(e) => setForm({ ...form, loginId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  ePharms 비밀번호 {modal === "add" ? "*" : "(변경할 때만 입력)"}
                </label>
                <input
                  type="password"
                  value={form.loginPw}
                  onChange={(e) => setForm({ ...form, loginPw: e.target.value })}
                  placeholder={modal === "edit" ? "비워두면 기존 PW 유지" : ""}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  서버에 AES-256-GCM 암호화하여 저장되며, 화면이나 API 응답에 절대 노출되지 않습니다.
                </p>
              </div>
              <div ref={kmdUserRef} className="relative">
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  KMD 아이디 매핑 <span className="text-gray-400 font-normal">(선택 — 마이페이지 노출용)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    value={kmdUserSearch}
                    onChange={(e) => { setKmdUserSearch(e.target.value); setKmdUserOpen(true); }}
                    onFocus={() => setKmdUserOpen(true)}
                    placeholder="이메일 / 이름 / 전화 검색…"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {selectedKmdUser && (
                    <button
                      type="button"
                      onClick={clearKmdUser}
                      className="px-2 py-2 text-xs text-red-500 hover:bg-red-50 rounded"
                      title="매핑 해제"
                    >
                      해제
                    </button>
                  )}
                </div>
                {selectedKmdUser && (
                  <p className="text-[11px] text-blue-600 mt-1">
                    선택됨: <span className="font-mono">{selectedKmdUser.email}</span>
                    {selectedKmdUser.name ? ` (${selectedKmdUser.name})` : ""}
                  </p>
                )}
                {kmdUserOpen && kmdUsers.length > 0 && (
                  <ul className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                    {kmdUsers.map((u) => (
                      <li
                        key={u.id}
                        onMouseDown={() => selectKmdUser(u)}
                        className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 flex items-center justify-between"
                      >
                        <span className="font-mono text-gray-800">{u.email}</span>
                        <span className="text-xs text-gray-400">{u.name ?? ""}{u.role ? ` · ${u.role}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {kmdUserOpen && kmdUserSearch.length > 0 && kmdUsers.length === 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-lg text-sm text-gray-400">
                    검색 결과 없음
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">메모</label>
                <textarea
                  value={form.memo}
                  rows={2}
                  onChange={(e) => setForm({ ...form, memo: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 pb-5">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {modal === "add" ? "추가" : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Upload 모달 */}
      {bulkModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => { if (!bulkSubmitting) setBulkModal(false); }}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Upload className="w-5 h-5 text-green-600" />
                엑셀 일괄등록
              </h2>
              {!bulkSubmitting && (
                <button onClick={() => setBulkModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
              )}
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-gray-500 leading-relaxed">
                  컬럼 순서:{" "}
                  {["사업자번호", "거래처명", "이팜스ID", "이팜스PW", "KMD아이디", "메모(선택)"].map((col) => (
                    <span key={col} className="inline-block font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded mr-1">{col}</span>
                  ))}
                </p>
                <button
                  onClick={async () => {
                    const { utils, write } = await import("xlsx");
                    const ws = utils.aoa_to_sheet([["사업자번호", "거래처명", "이팜스ID", "이팜스PW", "KMD아이디", "메모"]]);
                    const wb = utils.book_new();
                    utils.book_append_sheet(wb, ws, "원내거래처");
                    const buf = write(wb, { type: "array", bookType: "xlsx" });
                    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = "원내거래처_일괄등록_양식.xlsx"; a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  양식 다운로드
                </button>
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleBulkFileChange}
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-green-400", "bg-green-50"); }}
                  onDragLeave={(e) => { e.currentTarget.classList.remove("border-green-400", "bg-green-50"); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("border-green-400", "bg-green-50");
                    const file = e.dataTransfer.files[0];
                    if (file) {
                      setBulkFile(file);
                      setBulkResult(null);
                      import("xlsx").then(({ read, utils }) => {
                        file.arrayBuffer().then((buffer) => {
                          const wb = read(new Uint8Array(buffer), { type: "array" });
                          const ws = wb.Sheets[wb.SheetNames[0]];
                          const rows = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
                          setBulkPreview(rows.slice(0, 10).map((r) => ({
                            bizNumber: String(r["사업자번호"] ?? "").replace(/[^0-9]/g, ""),
                            clientName: String(r["거래처명"] ?? "").trim(),
                            loginId: String(r["이팜스ID"] ?? "").trim(),
                            loginPw: String(r["이팜스PW"] ?? "").trim(),
                            kmdEmail: String(r["KMD아이디"] ?? "").trim(),
                            kmdUserEmail: String(r["KMD아이디"] ?? "").trim(),
                            memo: String(r["메모"] ?? "").trim(),
                          })));
                        }).catch(() => setBulkPreview([]));
                      });
                    }
                  }}
                  className="cursor-pointer flex flex-col items-center justify-center gap-2 px-6 py-8 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-green-400 hover:bg-green-50 hover:text-green-700 transition-colors"
                >
                  <Upload className="w-7 h-7 text-gray-300" />
                  {bulkFile ? (
                    <span className="font-medium text-gray-700">{bulkFile.name}</span>
                  ) : (
                    <>
                      <span className="font-medium">파일을 여기에 끌어다 놓거나 클릭하여 선택</span>
                      <span className="text-xs text-gray-400">xlsx / xls</span>
                    </>
                  )}
                </div>
              </div>
              {bulkPreview.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">미리보기 (상위 {bulkPreview.length}행)</p>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full text-xs divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">사업자번호</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">거래처명</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">이팜스ID</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">PW</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">KMD아이디</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">메모</th>
                          <th className="px-3 py-2 text-left font-semibold text-blue-600">KMD아이디</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {bulkPreview.map((row, i) => (
                          <tr key={i} className={!row.bizNumber || !row.clientName || !row.loginId || !row.loginPw ? "bg-red-50" : ""}>
                            <td className="px-3 py-1.5 font-mono">{row.bizNumber || <span className="text-red-400">없음</span>}</td>
                            <td className="px-3 py-1.5">{row.clientName || <span className="text-red-400">없음</span>}</td>
                            <td className="px-3 py-1.5 font-mono">{row.loginId || <span className="text-red-400">없음</span>}</td>
                            <td className="px-3 py-1.5 font-mono">{row.loginPw ? "••••••" : <span className="text-red-400">없음</span>}</td>
                            <td className="px-3 py-1.5 text-gray-500">{row.kmdEmail || <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-1.5 text-gray-400">{row.memo || "—"}</td>
                            <td className="px-3 py-1.5 text-blue-600 font-mono text-[11px]">{row.kmdUserEmail || <span className="text-gray-300">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {bulkResult && (
                <div className={`rounded-lg p-4 text-sm ${bulkResult.errors.length > 0 ? "bg-yellow-50 border border-yellow-200" : "bg-green-50 border border-green-200"}`}>
                  <p className="font-semibold mb-1">
                    {bulkResult.created}개 등록, {bulkResult.updated}개 업데이트, {bulkResult.skipped}개 스킵
                  </p>
                  {bulkResult.errors.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-red-700">
                      {bulkResult.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 pb-5 flex-shrink-0 border-t pt-4">
              <button
                onClick={() => setBulkModal(false)}
                disabled={bulkSubmitting}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                닫기
              </button>
              <button
                onClick={handleBulkSubmit}
                disabled={!bulkFile || bulkSubmitting}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {bulkSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                일괄 등록
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 전체 탭 ──────────────────────────────────────────────────────────────────

function AllTab() {
  const [hospClients, setHospClients] = useState<HospClient[]>([]);
  const [dealerClients, setDealerClients] = useState<DealerClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/user-clients").then((r) => r.json()),
      fetch("/api/dealer").then((r) => r.json()),
    ]).then(([hosp, dealers]) => {
      setHospClients(Array.isArray(hosp) ? hosp : []);
      setDealerClients(Array.isArray(dealers) ? dealers : []);
    }).finally(() => setLoading(false));
  }, []);

  type CombinedItem =
    | { kind: "hosp"; id: string; clientName: string; bizNumber: string }
    | { kind: "dealer"; id: string; clientName: string; bizNumber: string; dealerType: DealerType };

  const combined: CombinedItem[] = useMemo(() => {
    const hosp: CombinedItem[] = hospClients.map((c) => ({
      kind: "hosp", id: c.id, clientName: c.clientName, bizNumber: c.bizNumber,
    }));
    const dealers: CombinedItem[] = dealerClients.map((c) => ({
      kind: "dealer", id: c.id, clientName: c.clientName, bizNumber: c.bizNumber, dealerType: c.dealerType,
    }));
    return [...hosp, ...dealers];
  }, [hospClients, dealerClients]);

  const filtered = useMemo(() => {
    if (!query) return combined;
    const q = query.toLowerCase();
    return combined.filter((c) => c.clientName.toLowerCase().includes(q) || c.bizNumber.includes(q));
  }, [combined, query]);

  const countHosp = hospClients.length;
  const countUpper = dealerClients.filter((c) => c.dealerType === "UPPER_CORP").length;
  const countLower = dealerClients.filter((c) => c.dealerType === "LOWER_CORP").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
        <span className="bg-gray-100 rounded-full px-3 py-1">전체 <strong className="text-gray-700">{combined.length}</strong></span>
        <span className="bg-blue-50 text-blue-700 rounded-full px-3 py-1">병의원 <strong>{countHosp}</strong></span>
        <span className="bg-indigo-50 text-indigo-700 rounded-full px-3 py-1">상위법인 <strong>{countUpper}</strong></span>
        <span className="bg-cyan-50 text-cyan-700 rounded-full px-3 py-1">하위법인 <strong>{countLower}</strong></span>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="거래처명 또는 사업자번호 검색" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9 text-sm" />
      </div>
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
          {query ? "검색 결과가 없습니다" : "등록된 거래처가 없습니다"}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="grid grid-cols-[1fr_auto_auto] text-xs font-semibold text-gray-500 px-4 py-2.5 bg-gray-50 border-b border-gray-100 rounded-t-xl">
            <span>거래처명</span>
            <span className="text-center w-32">사업자번호</span>
            <span className="text-center w-24">유형</span>
          </div>
          <div className="divide-y divide-gray-50">
            {filtered.map((c) => (
              <div key={`${c.kind}-${c.id}`} className="grid grid-cols-[1fr_auto_auto] items-center px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${c.kind === "hosp" ? "bg-blue-50" : "bg-purple-50"}`}>
                    {c.kind === "hosp"
                      ? <Hospital className="w-4 h-4 text-blue-500" />
                      : <Building2 className="w-4 h-4 text-purple-500" />}
                  </div>
                  <p className="text-sm font-medium text-gray-800">{c.clientName}</p>
                </div>
                <span className="text-sm text-gray-500 w-32 text-center font-mono">{formatBiz(c.bizNumber)}</span>
                <div className="w-24 flex justify-center">
                  {c.kind === "hosp" ? (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">병의원</span>
                  ) : (
                    <TypeBadge type={(c as { kind: "dealer"; dealerType: DealerType }).dealerType} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-gray-400 text-right">총 {filtered.length}개{query && ` (전체 ${combined.length}개 중)`}</p>
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

type Tab = "all" | "clients" | "inhouse-clients" | "upper-corp" | "lower-corp" | "sales-reps";

const TABS: { key: Tab; label: string; icon: React.ElementType; desc: string }[] = [
  { key: "all",             label: "전체",           icon: Users,      desc: "등록된 모든 거래처" },
  { key: "clients",         label: "병의원(원외)",   icon: Hospital,   desc: "병의원 등록·승인·H-코드 생성" },
  { key: "inhouse-clients", label: "병의원(원내)",   icon: Hospital,   desc: "원내 병·의원 이팜스 계정 관리" },
  { key: "upper-corp",      label: "상위법인",       icon: Building2,  desc: "상위법인 등록·C-코드 생성" },
  { key: "lower-corp",      label: "하위법인",       icon: Building2,  desc: "하위법인 등록·C-코드 생성" },
  { key: "sales-reps",      label: "영업사원",       icon: UserCheck,  desc: "영업사원 승인·S-코드 생성" },
];

function UsersPageInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    return (t === "sales-reps" || t === "inhouse-clients" || t === "upper-corp" || t === "lower-corp") ? t as Tab : "all";
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
        {tab === "all"             && <AllTab />}
        {tab === "clients"         && <ClientsTab />}
        {tab === "inhouse-clients" && <InhouseClientsTab />}
        {tab === "upper-corp"      && <DealersTab fixedType="UPPER_CORP" />}
        {tab === "lower-corp"      && <DealersTab fixedType="LOWER_CORP" />}
        {tab === "sales-reps"      && <SalesRepsTab />}
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
