"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Building2, User, ChevronDown, Tag, Loader2, Search, Plus, Trash2, X, Upload, CheckCircle, AlertCircle, Pencil, Hash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BizLayout } from "../page";

type DealerType = "CORPORATION" | "INDIVIDUAL" | "UPPER_CORP" | "LOWER_CORP" | "SELF" | null;
type ModalStep = "biz" | "checking" | "found" | "form" | "saving";

const DEALER_LABELS: Record<string, string> = {
  CORPORATION: "법인",
  UPPER_CORP:  "상위법인",
  SELF:        "자사",
  LOWER_CORP:  "하위법인",
  INDIVIDUAL:  "개인사업자(딜러)",
};

const DEALER_COLORS: Record<string, string> = {
  CORPORATION: "bg-blue-100 text-blue-700",
  UPPER_CORP:  "bg-indigo-100 text-indigo-700",
  SELF:        "bg-purple-100 text-purple-700",
  LOWER_CORP:  "bg-cyan-100 text-cyan-700",
  INDIVIDUAL:  "bg-green-100 text-green-700",
};

const TYPE_ORDER = ["CORPORATION", "UPPER_CORP", "SELF", "LOWER_CORP", "INDIVIDUAL"];

interface Client {
  id: string;
  clientName: string;
  bizNumber: string;
  dealerType: DealerType;
  approved: boolean;
  managerName?: string | null;
  managerPhone?: string | null;
  managerEmail?: string | null;
  memo?: string | null;
  code?: string | null;
  isSettlementTarget?: boolean | null;
  isRateTarget?: boolean | null;
}

function formatBiz(n: string) {
  const d = n.replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  return n;
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
  clientId: string;
  current: DealerType;
  onUpdated: (id: string, type: DealerType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function pick(type: DealerType) {
    setOpen(false);
    if (type === current) return;
    setSaving(true);
    const res = await fetch(`/api/dealer?id=${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealerType: type }),
    });
    setSaving(false);
    if (res.ok) onUpdated(clientId, type);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-md px-2 py-1 bg-white"
        disabled={saving}
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Tag className="w-3 h-3" />}
        분류
        <ChevronDown className="w-3 h-3" />
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

function FileInput({ label, file, onChange, inputRef }: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div
      onClick={() => inputRef.current?.click()}
      className="flex items-center gap-2.5 border border-dashed border-gray-300 rounded-lg px-3 py-2.5 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
    >
      <Upload className="w-4 h-4 text-gray-400 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-gray-500 leading-tight">{label}</p>
        <p className={`text-xs truncate mt-0.5 ${file ? "text-blue-600 font-medium" : "text-gray-400"}`}>
          {file ? file.name : "파일 선택 (PDF, 이미지)"}
        </p>
      </div>
      {file && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChange(null); if (inputRef.current) inputRef.current.value = ""; }}
          className="ml-auto text-gray-300 hover:text-red-400 shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,image/*"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </div>
  );
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

function FieldInput({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-600">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

export default function BizDealersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("ALL");

  type ClassificationTab = "all" | "settlement" | "rate";
  const [classificationTab, setClassificationTab] = useState<ClassificationTab>("all");

  // 등록 모달 state
  const [modal, setModal] = useState(false);
  const [step, setStep] = useState<ModalStep>("biz");
  const [bizNumberInput, setBizNumberInput] = useState("");
  const [foundClient, setFoundClient] = useState<Client | null>(null);
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

  // 수정 모달 state
  const [editModal, setEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Client | null>(null);
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
    fetch("/api/dealer")
      .then((r) => r.json())
      .then((d) => setClients(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role;
    if (role !== "BIZ" && role !== "ADMIN") { router.push("/"); return; }
    load();
  }, [session, status, router, load]);

  function openModal() {
    setStep("biz");
    setBizNumberInput("");
    setFoundClient(null);
    setClientName("");
    setDealerType("CORPORATION");
    setManagerName(""); setManagerPhone(""); setManagerEmail(""); setMemo("");
    setBizFile(null); setCsoFile(null); setAccountFile(null);
    setFormError(null);
    setModal(true);
  }

  function openEdit(c: Client) {
    setEditTarget(c);
    setEditName(c.clientName);
    setEditType(c.dealerType ?? "CORPORATION");
    setEditManagerName(c.managerName ?? "");
    setEditManagerPhone(c.managerPhone ?? "");
    setEditManagerEmail(c.managerEmail ?? "");
    setEditMemo(c.memo ?? "");
    setEditError(null);
    setEditModal(true);
  }

  async function handleBizCheck() {
    const raw = bizNumberInput.replace(/\D/g, "");
    if (raw.length < 10) { setFormError("사업자번호 10자리를 입력해주세요."); return; }
    setFormError(null);
    setStep("checking");
    const res = await fetch(`/api/dealer?bizNumber=${raw}`);
    const d = await res.json();
    if (d.found) {
      setFoundClient(d.client);
      setStep("found");
    } else {
      setStep("form");
    }
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          bizNumber: bizNumberInput,
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
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || "등록 실패"); setStep("form"); return; }
      setModal(false);
      load();
    } catch {
      setFormError("오류가 발생했습니다."); setStep("form");
    }
  }

  async function handleEditSave() {
    if (!editTarget) return;
    if (!editName.trim()) { setEditError("거래처명을 입력해주세요."); return; }
    setEditSaving(true);
    const res = await fetch(`/api/dealer?id=${editTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientName: editName.trim(),
        dealerType: editType || null,
        managerName: editManagerName.trim() || null,
        managerPhone: editManagerPhone.trim() || null,
        managerEmail: editManagerEmail.trim() || null,
        memo: editMemo.trim() || null,
      }),
    });
    setEditSaving(false);
    if (res.ok) {
      const updated = await res.json();
      setClients((prev) => prev.map((c) => c.id === editTarget.id ? { ...c, ...updated } : c));
      setEditModal(false);
    } else {
      const d = await res.json();
      setEditError(d.error ?? "수정 실패");
    }
  }

  const handleUpdated = useCallback((id: string, type: DealerType) => {
    setClients((prev) => prev.map((c) => c.id === id ? { ...c, dealerType: type } : c));
  }, []);

  async function handleDelete(c: Client) {
    if (!confirm(`"${c.clientName}" 을(를) 삭제할까요?`)) return;
    const res = await fetch(`/api/dealer?id=${c.id}`, { method: "DELETE" });
    if (res.ok) setClients((prev) => prev.filter((x) => x.id !== c.id));
  }

  async function toggleClassification(
    c: Client,
    field: "isSettlementTarget" | "isRateTarget"
  ) {
    const next = !(c[field] ?? false);
    setClients((prev) => prev.map((x) => x.id === c.id ? { ...x, [field]: next } : x));
    try {
      const res = await fetch(`/api/dealer?id=${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setClients((prev) => prev.map((x) => x.id === c.id ? { ...x, [field]: !next } : x));
    }
  }

  async function generateCode(id: string) {
    setGeneratingCode(id);
    try {
      const res = await fetch("/api/generate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "corp", id }),
      });
      const data = await res.json();
      if (data.code) {
        setClients((prev) => prev.map((c) => c.id === id ? { ...c, code: data.code } : c));
      }
    } finally {
      setGeneratingCode(null);
    }
  }

  const filtered = clients.filter((c) => {
    // 분류 뷰 탭 필터
    if (classificationTab === "settlement" && !(c.isSettlementTarget ?? false)) return false;
    if (classificationTab === "rate"       && !(c.isRateTarget ?? false)) return false;
    const matchQ = !query || c.clientName.includes(query) || c.bizNumber.includes(query);
    const matchT = filterType === "ALL" || (filterType === "NONE" ? !c.dealerType : c.dealerType === filterType);
    return matchQ && matchT;
  });

  const counts: Record<string, number> = { ALL: clients.length, NONE: 0 };
  for (const t of TYPE_ORDER) counts[t] = 0;
  for (const c of clients) {
    if (!c.dealerType) counts.NONE++;
    else counts[c.dealerType] = (counts[c.dealerType] ?? 0) + 1;
  }

  return (
    <BizLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">법인·딜러 등록/관리</h2>
            <p className="text-xs text-gray-500 mt-0.5">거래처를 법인 계층별로 분류합니다</p>
          </div>
          <button
            onClick={openModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            법인·딜러 등록
          </button>
        </div>

        {/* 검색 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="거래처명 또는 사업자번호 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>

        {/* 분류 뷰 탭 */}
        <div className="flex gap-1 mb-2">
          {(["all", "settlement", "rate"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setClassificationTab(tab)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                classificationTab === tab
                  ? "bg-teal-700 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab === "all" ? "전체" : tab === "settlement" ? "정산 대상" : "요율 대상"}
            </button>
          ))}
        </div>

        {/* 타입 필터 탭 */}
        <div className="flex gap-1 flex-wrap">
          {[["ALL", "전체"], ["NONE", "미분류"], ...TYPE_ORDER.map((t) => [t, DEALER_LABELS[t]])].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilterType(key)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                filterType === key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {label} {counts[key] !== undefined ? `(${counts[key]})` : ""}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
            {query ? "검색 결과가 없어요." : "등록된 항목이 없어요."}
          </div>
        ) : (
          /* overflow-visible: 분류 드롭다운이 컨테이너에 잘리지 않도록 */
          <div className="bg-white border border-gray-200 rounded-xl">
            <div className="divide-y divide-gray-50">
              {filtered.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                      {c.dealerType === "INDIVIDUAL" ? <User className="w-4 h-4 text-gray-500" /> : <Building2 className="w-4 h-4 text-gray-500" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-800">{c.clientName}</p>
                        <TypeBadge type={c.dealerType} />
                      </div>
                      <p className="text-xs text-gray-400">{formatBiz(c.bizNumber)}</p>
                      {c.managerName && (
                        <p className="text-xs text-gray-400 mt-0.5">담당: {c.managerName}{c.managerPhone ? ` · ${c.managerPhone}` : ""}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {c.code ? (
                      <span className="inline-flex items-center gap-1 text-xs font-mono bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                        <Hash className="w-3 h-3" />{c.code}
                      </span>
                    ) : (
                      <button
                        onClick={() => generateCode(c.id)}
                        disabled={generatingCode === c.id}
                        className="flex items-center gap-1 text-xs px-2 py-0.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {generatingCode === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hash className="w-3 h-3" />}
                        코드
                      </button>
                    )}
                    <button
                      onClick={() => toggleClassification(c, "isSettlementTarget")}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                        (c.isSettlementTarget ?? false)
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                      }`}
                      title="정산내역서 업로드 대상으로 분류"
                    >
                      정산
                    </button>
                    <button
                      onClick={() => toggleClassification(c, "isRateTarget")}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                        (c.isRateTarget ?? false)
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                      }`}
                      title="요율표 관리 대상으로 분류"
                    >
                      요율
                    </button>
                    <TypeDropdown clientId={c.id} current={c.dealerType} onUpdated={handleUpdated} />
                    <button
                      onClick={() => openEdit(c)}
                      className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                      title="수정"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(c)}
                      className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 등록 모달 */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
              <h2 className="font-semibold text-gray-900">법인·딜러 등록</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              {/* Step 1: 사업자번호 입력 */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-600">사업자번호 *</label>
                <div className="flex gap-2">
                  <input
                    value={bizNumberInput}
                    onChange={(e) => {
                      setBizNumberInput(formatBizNum(e.target.value));
                      if (step === "found" || step === "form") setStep("biz");
                      setFormError(null);
                    }}
                    placeholder="000-00-00000  (자동 하이픈)"
                    maxLength={12}
                    disabled={step === "checking" || step === "saving"}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                    onKeyDown={(e) => e.key === "Enter" && step === "biz" && handleBizCheck()}
                  />
                  <button
                    onClick={handleBizCheck}
                    disabled={step === "checking" || step === "saving" || !bizNumberInput.trim()}
                    className="px-3 py-2 text-sm font-medium bg-gray-800 hover:bg-gray-700 text-white rounded-lg disabled:opacity-40 whitespace-nowrap flex items-center gap-1.5"
                  >
                    {step === "checking" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    조회
                  </button>
                </div>
                {formError && step !== "form" && (
                  <p className="text-xs text-red-600">{formError}</p>
                )}
              </div>

              {/* 이미 등록된 경우 */}
              {step === "found" && foundClient && (
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-amber-800">이미 등록된 사업자번호입니다</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      {foundClient.clientName}
                      {foundClient.dealerType && (
                        <span className="ml-1.5 text-amber-600">({DEALER_LABELS[foundClient.dealerType] ?? foundClient.dealerType})</span>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {/* Step 2: 거래처 정보 입력 */}
              {(step === "form" || step === "saving") && (
                <>
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    <p className="text-xs text-green-700">등록 가능한 사업자번호입니다</p>
                  </div>

                  {formError && (
                    <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>
                  )}

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-600">거래처명 *</label>
                    <input
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="예: (주)이음메디컬"
                      disabled={step === "saving"}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-600">유형</label>
                    <div className="grid grid-cols-2 gap-2">
                      {TYPE_ORDER.map((t) => (
                        <button
                          key={t}
                          type="button"
                          disabled={step === "saving"}
                          onClick={() => setDealerType(t)}
                          className={`px-3 py-2 text-xs rounded-lg border font-medium transition-colors text-left ${
                            dealerType === t
                              ? `${DEALER_COLORS[t]} border-transparent`
                              : "border-gray-200 text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          {DEALER_LABELS[t]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 담당자 정보 */}
                  <div className="border-t border-gray-100 pt-3 space-y-3">
                    <p className="text-xs font-semibold text-gray-500">담당자 정보 (선택)</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-gray-600">담당자명</label>
                        <input value={managerName} onChange={(e) => setManagerName(e.target.value)}
                          placeholder="홍길동" disabled={step === "saving"}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-gray-600">담당자연락처</label>
                        <input value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)}
                          placeholder="010-0000-0000" disabled={step === "saving"}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-600">담당자이메일</label>
                      <input value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)}
                        type="email" placeholder="example@email.com" disabled={step === "saving"}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-600">비고(메모)</label>
                      <textarea value={memo} onChange={(e) => setMemo(e.target.value)}
                        placeholder="메모를 입력하세요" rows={2} disabled={step === "saving"}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 resize-none" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-gray-600">서류 첨부 (선택)</label>
                    <FileInput label="CSO신고증" file={csoFile} onChange={setCsoFile} inputRef={csoRef} />
                    <FileInput label="사업자등록증" file={bizFile} onChange={setBizFile} inputRef={bizRef} />
                    <FileInput label="계좌사본" file={accountFile} onChange={setAccountFile} inputRef={accountRef} />
                  </div>
                </>
              )}
            </div>

            <div className="px-6 pb-5 flex gap-2 justify-end shrink-0 border-t border-gray-100 pt-4">
              {step === "found" ? (
                <button onClick={() => setModal(false)}
                  className="px-5 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg">닫기</button>
              ) : (
                <>
                  <button onClick={() => setModal(false)}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
                  {(step === "form" || step === "saving") && (
                    <button onClick={handleAdd} disabled={step === "saving"}
                      className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5">
                      {step === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      등록
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 수정 모달 */}
      {editModal && editTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
              <h2 className="font-semibold text-gray-900">거래처 정보 수정</h2>
              <button onClick={() => setEditModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500">
                사업자번호: <span className="font-mono font-medium text-gray-700">{formatBiz(editTarget.bizNumber)}</span>
              </div>

              {editError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{editError}</p>
              )}

              <FieldInput label="거래처명 *" value={editName} onChange={setEditName} placeholder="거래처명 입력" />

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-600">유형</label>
                <div className="grid grid-cols-2 gap-2">
                  {TYPE_ORDER.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setEditType(t)}
                      className={`px-3 py-2 text-xs rounded-lg border font-medium transition-colors text-left ${
                        editType === t
                          ? `${DEALER_COLORS[t]} border-transparent`
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {DEALER_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-gray-100 pt-3 space-y-3">
                <p className="text-xs font-semibold text-gray-500">담당자 정보</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-600">담당자명</label>
                    <input value={editManagerName} onChange={(e) => setEditManagerName(e.target.value)}
                      placeholder="홍길동"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-600">담당자연락처</label>
                    <input value={editManagerPhone} onChange={(e) => setEditManagerPhone(e.target.value)}
                      placeholder="010-0000-0000"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600">담당자이메일</label>
                  <input value={editManagerEmail} onChange={(e) => setEditManagerEmail(e.target.value)}
                    type="email" placeholder="example@email.com"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600">비고(메모)</label>
                  <textarea value={editMemo} onChange={(e) => setEditMemo(e.target.value)}
                    placeholder="메모를 입력하세요" rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                </div>
              </div>
            </div>

            <div className="px-6 pb-5 flex gap-2 justify-end shrink-0 border-t border-gray-100 pt-4">
              <button onClick={() => setEditModal(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={handleEditSave} disabled={editSaving}
                className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5">
                {editSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </BizLayout>
  );
}
