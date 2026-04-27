"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Building2, User, ChevronDown, Tag, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type DealerType = "CORPORATION" | "INDIVIDUAL" | "UPPER_CORP" | "LOWER_CORP" | "SELF" | null;

const DEALER_LABELS: Record<string, string> = {
  CORPORATION:  "법인",
  UPPER_CORP:   "상위법인",
  SELF:         "자사",
  LOWER_CORP:   "하위법인",
  INDIVIDUAL:   "개인사업자(딜러)",
};

const DEALER_COLORS: Record<string, string> = {
  CORPORATION:  "bg-blue-100 text-blue-700",
  UPPER_CORP:   "bg-indigo-100 text-indigo-700",
  SELF:         "bg-purple-100 text-purple-700",
  LOWER_CORP:   "bg-cyan-100 text-cyan-700",
  INDIVIDUAL:   "bg-green-100 text-green-700",
};

const TYPE_ORDER = ["CORPORATION", "UPPER_CORP", "SELF", "LOWER_CORP", "INDIVIDUAL"];

interface Client {
  id: string;
  clientName: string;
  bizNumber: string;
  dealerType: DealerType;
  approved: boolean;
}

function DealerBadge({ type }: { type: DealerType }) {
  if (!type) return <span className="text-xs text-gray-400">미분류</span>;
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
        분류 변경
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]">
            <button
              onClick={() => pick(null)}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
            >
              미분류
            </button>
            {TYPE_ORDER.map((t) => (
              <button
                key={t}
                onClick={() => pick(t as DealerType)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${current === t ? "font-bold" : ""}`}
              >
                {DEALER_LABELS[t]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function GroupSection({ type, clients, onUpdated }: {
  type: string | null;
  clients: Client[];
  onUpdated: (id: string, t: DealerType) => void;
}) {
  const label = type ? DEALER_LABELS[type] ?? type : "미분류";
  const color = type ? DEALER_COLORS[type] : "bg-gray-100 text-gray-500";

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>{label}</span>
        <span className="text-xs text-gray-400">{clients.length}개</span>
      </div>
      <div className="divide-y divide-gray-50">
        {clients.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                {type === "INDIVIDUAL" ? (
                  <User className="w-4 h-4 text-gray-500" />
                ) : (
                  <Building2 className="w-4 h-4 text-gray-500" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-800">{c.clientName}</p>
                <p className="text-xs text-gray-400">{c.bizNumber}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {c.approved && <span className="text-xs text-green-600 font-medium">승인됨</span>}
              <TypeDropdown clientId={c.id} current={c.dealerType} onUpdated={onUpdated} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DealerPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    if (session.user.role !== "BIZ" && session.user.role !== "ADMIN") {
      router.push("/mypage");
      return;
    }
    fetch("/api/user-clients")
      .then((r) => r.json())
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [session, status, router]);

  const handleUpdated = useCallback((id: string, type: DealerType) => {
    setClients((prev) => prev.map((c) => c.id === id ? { ...c, dealerType: type } : c));
  }, []);

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // group by dealerType
  const groups: Record<string, Client[]> = {};
  const allTypes = [...TYPE_ORDER, null as unknown as string];
  for (const t of allTypes) groups[t ?? "null"] = [];
  for (const c of clients) {
    const key = c.dealerType ?? "null";
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }

  const hierarchy = [
    { label: "거래 계층 구조", types: TYPE_ORDER },
    { label: "미분류", types: [null as unknown as string] },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-4 mt-4 pb-8">
      <div className="flex items-center gap-3">
        <Link href="/mypage">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            마이페이지
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-bold text-gray-900">딜러 관리</h1>
          <p className="text-xs text-gray-500">거래처를 계층별로 분류하세요</p>
        </div>
      </div>

      {/* 계층 안내 */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
        <p className="text-xs text-blue-700 font-medium mb-1">계층 구조 안내</p>
        <div className="flex flex-wrap items-center gap-1 text-xs text-blue-600">
          {TYPE_ORDER.map((t, i) => (
            <span key={t} className="flex items-center gap-1">
              <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${DEALER_COLORS[t]}`}>{DEALER_LABELS[t]}</span>
              {i < TYPE_ORDER.length - 1 && <span className="text-blue-400">→</span>}
            </span>
          ))}
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
          등록된 거래처가 없습니다
        </div>
      ) : (
        <div className="space-y-3">
          {allTypes.map((t) => {
            const key = t ?? "null";
            const list = groups[key] ?? [];
            if (list.length === 0) return null;
            return (
              <GroupSection
                key={key}
                type={t ?? null}
                clients={list}
                onUpdated={handleUpdated}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
