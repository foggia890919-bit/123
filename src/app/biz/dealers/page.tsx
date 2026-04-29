"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Building2, User, ChevronDown, Tag, Loader2, Search, Plus, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BizLayout } from "../page";

type DealerType = "CORPORATION" | "INDIVIDUAL" | "UPPER_CORP" | "LOWER_CORP" | "SELF" | null;

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
            <button onClick={() => pick(null)} className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50">
              미분류
            </button>
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

const EMPTY_FORM = { clientName: "", bizNumber: "", dealerType: "CORPORATION" as string };

export default function BizDealersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("ALL");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/user-clients")
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

  const handleUpdated = useCallback((id: string, type: DealerType) => {
    setClients((prev) => prev.map((c) => c.id === id ? { ...c, dealerType: type } : c));
  }, []);

  async function handleDelete(c: Client) {
    if (!confirm(`"${c.clientName}" 을(를) 삭제할까요?`)) return;
    const res = await fetch(`/api/dealer?id=${c.id}`, { method: "DELETE" });
    if (res.ok) setClients((prev) => prev.filter((x) => x.id !== c.id));
  }

  async function handleAdd() {
    setFormError(null);
    if (!form.clientName.trim() || !form.bizNumber.trim()) {
      setFormError("거래처명과 사업자번호는 필수입니다.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/dealer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, dealerType: form.dealerType || null }),
      });
      const d = await res.json();
      if (!res.ok) { setFormError(d.error || "등록 실패"); return; }
      setModal(false);
      setForm(EMPTY_FORM);
      load();
    } finally {
      setSaving(false);
    }
  }

  const filtered = clients.filter((c) => {
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
            onClick={() => { setForm(EMPTY_FORM); setFormError(null); setModal(true); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            법인·딜러 등록
          </button>
        </div>

        {/* 계층 안내 */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
          <p className="text-xs font-semibold text-blue-700 mb-1.5">계층 구조</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs mb-3">
            {TYPE_ORDER.map((t, i) => (
              <span key={t} className="flex items-center gap-1">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${DEALER_COLORS[t]}`}>{DEALER_LABELS[t]}</span>
                {i < TYPE_ORDER.length - 1 && <span className="text-blue-300">→</span>}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="flex gap-2">
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium h-fit ${DEALER_COLORS["CORPORATION"]}`}>법인</span>
              <p className="text-xs text-blue-700/70">없어도 됨</p>
            </div>
            <div className="flex gap-2">
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium h-fit ${DEALER_COLORS["UPPER_CORP"]}`}>상위법인</span>
              <p className="text-xs text-blue-700/70">통계 및 필터링 요청하는 법인</p>
            </div>
            <div className="flex gap-2">
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium h-fit ${DEALER_COLORS["LOWER_CORP"]}`}>하위법인</span>
              <p className="text-xs text-blue-700/70">통계 및 필터링을 자사로 요청하는 법인, 자사에서 내역서 및 수수료율을 제공</p>
            </div>
          </div>
        </div>

        {/* 검색 + 필터 */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="거래처명 또는 사업자번호 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
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
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="divide-y divide-gray-50">
              {filtered.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                      {c.dealerType === "INDIVIDUAL"
                        ? <User className="w-4 h-4 text-gray-500" />
                        : <Building2 className="w-4 h-4 text-gray-500" />
                      }
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-800">{c.clientName}</p>
                        <TypeBadge type={c.dealerType} />
                      </div>
                      <p className="text-xs text-gray-400">{c.bizNumber}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <TypeDropdown clientId={c.id} current={c.dealerType} onUpdated={handleUpdated} />
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">법인·딜러 등록</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">거래처명 *</label>
                <input
                  value={form.clientName}
                  onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                  placeholder="예: (주)와이케이메디"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">사업자번호 *</label>
                <input
                  value={form.bizNumber}
                  onChange={(e) => setForm({ ...form, bizNumber: e.target.value })}
                  placeholder="000-00-00000"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-600">유형</label>
                <div className="grid grid-cols-2 gap-2">
                  {TYPE_ORDER.map((t) => (
                    <button
                      key={t}
                      onClick={() => setForm({ ...form, dealerType: t })}
                      className={`px-3 py-2 text-xs rounded-lg border font-medium transition-colors text-left ${
                        form.dealerType === t
                          ? `${DEALER_COLORS[t]} border-transparent`
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {DEALER_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                취소
              </button>
              <button
                onClick={handleAdd}
                disabled={saving}
                className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                등록
              </button>
            </div>
          </div>
        </div>
      )}
    </BizLayout>
  );
}
