"use client";

import { useState } from "react";
import { Search, Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import MedicationTable, { type ColumnVisibility } from "@/components/MedicationTable";
import ColumnToggles from "@/components/ColumnToggles";
import RequireAuth from "@/components/RequireAuth";
import { useSession } from "next-auth/react";
import type { MedicationItem } from "@/types";

export default function SettlementSearchPage() {
  const { data: session } = useSession();
  const isSalesRep = session?.user?.role === "SALES_REP";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MedicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [displayedQuery, setDisplayedQuery] = useState("");
  const [cols, setCols] = useState<ColumnVisibility>({ showRate: true });

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true); setSearched(true); setDisplayedQuery(query);
    try {
      const userId = session?.user?.id ? `&userId=${session.user.id}` : "";
      const res = await fetch(`/api/medications/search?q=${encodeURIComponent(query)}&settlement=true${userId}`);
      const data = await res.json();
      setResults(data.medications || []); setTotal(data.total || 0);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }

  return (
    <RequireAuth>
      <div className="space-y-5">
        {!searched && (
          <div className="text-center space-y-2 py-10">
            <div className="flex justify-center mb-3">
              <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-700 text-sm font-medium px-3 py-1 rounded-full">
                <Building2 className="w-4 h-4" />정산제약사 전용
              </span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">정산제약사 검색</h1>
            <p className="text-gray-400">정산 가능한 제약사 품목만 검색합니다</p>
          </div>
        )}
        {searched && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
              <Building2 className="w-3 h-3" />정산제약사
            </span>
            검색 &gt; <span className="font-semibold text-gray-800">{displayedQuery}</span>
          </div>
        )}
        <form onSubmit={handleSearch} className="flex gap-2 max-w-2xl">
          <Input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="제품명, 성분명, 제약사명으로 검색..." className="h-11 text-base" />
          <Button type="submit" size="lg" disabled={loading}><Search className="w-4 h-4 mr-2" />검색</Button>
        </form>
        {searched && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm text-gray-500">정산제약사 검색 결과 <span className="font-semibold text-gray-900">{total.toLocaleString()}개</span></p>
              <ColumnToggles cols={cols} setCols={setCols} isSalesRep={isSalesRep} />
            </div>
            <MedicationTable medications={results} loading={loading} {...cols} showRate={isSalesRep ? cols.showRate : false} userId={session?.user?.id} />
          </>
        )}
      </div>
    </RequireAuth>
  );
}
