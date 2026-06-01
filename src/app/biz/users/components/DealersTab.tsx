"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Building2, Search, Plus, Trash2, Loader2, Upload, Download,
  X, AlertCircle, CheckCircle, Tag, ChevronDown, Pencil, Hash,
  ToggleLeft, ToggleRight, KeyRound,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatBiz, formatBizNum, fileToDataUri } from "./utils";
import type { DealerType, DealerModalStep, DealerClient } from "./types";
import { DEALER_LABELS, DEALER_COLORS, TYPE_ORDER } from "./types";

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
  const [editCorpClass, setEditCorpClass] = useState<string>("GENERAL");
  const [editGrade, setEditGrade] = useState<string>("");
  const [editBaseDate, setEditBaseDate] = useState<string>("");
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
    setEditManagerEmail(c.managerEmail ?? ""); setEditMemo(c.memo ?? "");
    setEditCorpClass(c.corpClassification ?? "GENERAL");
    setEditGrade(c.partnerGrade ?? "");
    setEditBaseDate(c.promotionBaseDate ? c.promotionBaseDate.slice(0, 10) : "");
    setEditError(null); setEditModal(true);
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
        corpClassification: editCorpClass || "GENERAL",
        partnerGrade: editCorpClass === "PARTNER" ? (editGrade || null) : null,
        promotionBaseDate: editBaseDate ? new Date(editBaseDate).toISOString() : null,
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

              {/* 협력법인 프로모션 설정 */}
              <div className="border-t pt-4 mt-2 space-y-3">
                <p className="text-sm font-semibold text-gray-700">협력법인 프로모션</p>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600">법인 분류</label>
                  <div className="flex gap-2">
                    {[
                      { v: "GENERAL", label: "일반법인", color: "bg-gray-100 text-gray-700 border-gray-300" },
                      { v: "PARTNER", label: "협력법인", color: "bg-amber-50 text-amber-700 border-amber-300" },
                    ].map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        onClick={() => setEditCorpClass(o.v)}
                        className={`flex-1 px-3 py-2 text-xs font-medium border rounded-lg transition-all ${
                          editCorpClass === o.v ? `${o.color} ring-2 ring-offset-1` : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                {editCorpClass === "PARTNER" && (
                  <>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-600">등급</label>
                      <div className="flex gap-2">
                        {[
                          { v: "A", label: "A등급 (-0.5%)", desc: "5억 이상" },
                          { v: "B", label: "B등급 (-1%)", desc: "1억 이상" },
                          { v: "C", label: "C등급 (-2%)", desc: "5천 이상" },
                        ].map((g) => (
                          <button
                            key={g.v}
                            type="button"
                            onClick={() => setEditGrade(g.v)}
                            className={`flex-1 px-2 py-2 text-xs border rounded-lg transition-all ${
                              editGrade === g.v
                                ? "bg-blue-50 text-blue-700 border-blue-300 ring-2 ring-blue-200"
                                : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                            }`}
                          >
                            <div className="font-medium">{g.label}</div>
                            <div className="text-[10px] text-gray-400 mt-0.5">{g.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-600">
                        프로모션 기준일
                        <span className="ml-1 text-gray-400 font-normal">(이 날짜 이후 등록된 거래처만 적용)</span>
                      </label>
                      <input
                        type="date"
                        value={editBaseDate}
                        onChange={(e) => setEditBaseDate(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </>
                )}
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

export { TypeBadge, TypeDropdown };
export default DealersTab;
