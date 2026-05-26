"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Hospital, Search, Plus, Trash2, Loader2, Upload,
  X, AlertCircle, Hash, CheckCircle, Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatBiz, formatBizNum, fileToDataUri } from "./utils";
import type { HospClient, GlobalClient, ModalStep } from "./types";

export default function ClientsTab() {
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
