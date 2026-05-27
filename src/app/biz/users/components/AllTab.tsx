"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, Building2, Hospital, Users, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatBiz } from "./utils";
import type { AllClient, DealerType } from "./types";
import { DEALER_LABELS } from "./types";

export default function AllTab() {
  const [clients, setClients] = useState<AllClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/user-clients?all=true")
      .then((r) => r.json())
      .then((d) => setClients(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!query) return clients;
    const q = query.toLowerCase();
    return clients.filter((c) =>
      c.clientName.toLowerCase().includes(q) ||
      c.bizNumber.includes(q) ||
      (c.user.name || "").toLowerCase().includes(q) ||
      c.user.email.toLowerCase().includes(q)
    );
  }, [clients, query]);

  const countHosp = clients.filter((c) => !c.dealerType).length;
  const countUpper = clients.filter((c) => c.dealerType === "UPPER_CORP").length;
  const countLower = clients.filter((c) => c.dealerType === "LOWER_CORP").length;

  const typeLabel = (type?: string | null) => {
    if (!type) return { label: "병의원", cls: "bg-blue-100 text-blue-700" };
    if (type === "UPPER_CORP") return { label: "상위법인", cls: "bg-indigo-100 text-indigo-700" };
    if (type === "LOWER_CORP") return { label: "하위법인", cls: "bg-cyan-100 text-cyan-700" };
    return { label: type, cls: "bg-gray-100 text-gray-600" };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
        <span className="bg-gray-100 rounded-full px-3 py-1">전체 <strong className="text-gray-700">{clients.length}</strong></span>
        <span className="bg-blue-50 text-blue-700 rounded-full px-3 py-1">병의원 <strong>{countHosp}</strong></span>
        <span className="bg-indigo-50 text-indigo-700 rounded-full px-3 py-1">상위법인 <strong>{countUpper}</strong></span>
        <span className="bg-cyan-50 text-cyan-700 rounded-full px-3 py-1">하위법인 <strong>{countLower}</strong></span>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="거래처명·사업자번호·담당자 검색" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9 text-sm" />
      </div>
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
          {query ? "검색 결과가 없습니다" : "등록된 거래처가 없습니다"}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="grid grid-cols-[1fr_auto_auto_auto] text-xs font-semibold text-gray-500 px-4 py-2.5 bg-gray-50 border-b border-gray-100 rounded-t-xl">
            <span>거래처명</span>
            <span className="text-center w-32">사업자번호</span>
            <span className="text-center w-24">유형</span>
            <span className="text-center w-40">등록자</span>
          </div>
          <div className="divide-y divide-gray-50">
            {filtered.map((c) => {
              const { label, cls } = typeLabel(c.dealerType);
              return (
                <div key={c.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${!c.dealerType ? "bg-blue-50" : "bg-purple-50"}`}>
                      {!c.dealerType ? <Hospital className="w-4 h-4 text-blue-500" /> : <Building2 className="w-4 h-4 text-purple-500" />}
                    </div>
                    <p className="text-sm font-medium text-gray-800">{c.clientName}</p>
                  </div>
                  <span className="text-sm text-gray-500 w-32 text-center font-mono">{formatBiz(c.bizNumber)}</span>
                  <div className="w-24 flex justify-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
                  </div>
                  <div className="w-40 text-right">
                    <p className="text-xs font-medium text-gray-700">{c.user.name || "-"}</p>
                    <p className="text-[10px] text-gray-400 truncate">{c.user.email}</p>
                    {c.user.phone && <p className="text-[10px] text-gray-400">{c.user.phone}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="text-xs text-gray-400 text-right">총 {filtered.length}개{query && ` (전체 ${clients.length}개 중)`}</p>
    </div>
  );
}
