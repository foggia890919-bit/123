"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import MedicationTable, { type ColumnVisibility } from "@/components/MedicationTable";
import ColumnToggles from "@/components/ColumnToggles";
import RequireAuth from "@/components/RequireAuth";
import { useSession } from "next-auth/react";
import type { MedicationItem } from "@/types";

export default function SearchPage() {
  const { data: session } = useSession();
  const isSalesRep = session?.user?.role === "SALES_REP";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MedicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [displayedQuery, setDisplayedQuery] = useState("");
  const [cols, setCols] = useState<ColumnVisibility>({ showRate: true, showInsuranceCode: true });

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true); setSearched(true); setDisplayedQuery(query);
    try {
      const userId = session?.user?.id ? `&userId=${session.user.id}` : "";
      const res = await fetch(`/api/medications/search?q=${encodeURIComponent(query)}${userId}`);
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
            <h1 className="text-3xl font-bold text-gray-900">대체의약품 검색</h1>
            <p className="text-gray-400">제품명 또는 성분명으로 검색하세요</p>
          </div>
        )}
        {searched && (
          <div className="text-sm text-gray-500">
            통합 검색 &gt; <span className="font-semibold text-gray-800">{displayedQuery}</span>
          </div>
        )}
        <form onSubmit={handleSearch} className="flex gap-2 max-w-2xl">
          <Input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 리피토, atorvastatin, 아스피린..." className="h-11 text-base" />
          <Button type="submit" size="lg" disabled={loading}><Search className="w-4 h-4 mr-2" />검색</Button>
        </form>
        {searched && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm text-gray-500">검색 결과 <span className="font-semibold text-gray-900">{total.toLocaleString()}개</span></p>
              <ColumnToggles cols={cols} setCols={setCols} isSalesRep={isSalesRep} />
            </div>
            <MedicationTable medications={results} loading={loading} {...cols} showRate={isSalesRep ? cols.showRate : false} userId={session?.user?.id} />
          </>
        )}
      </div>
    </RequireAuth>
  );
}
