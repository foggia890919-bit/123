"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import MedicationTable from "@/components/MedicationTable";
import type { MedicationItem } from "@/types";

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MedicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/medications/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data.medications || []);
      setTotal(data.total || 0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2 py-8">
        <h1 className="text-3xl font-bold text-gray-900">대체의약품 검색</h1>
        <p className="text-gray-500">제품명 또는 성분명으로 대체의약품을 검색하세요</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 max-w-2xl mx-auto">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="예: 리피토, atorvastatin, 아스피린..."
          className="h-12 text-base"
        />
        <Button type="submit" size="lg" disabled={loading}>
          <Search className="w-5 h-5 mr-2" />
          {loading ? "검색 중..." : "검색"}
        </Button>
      </form>

      {searched && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500">
            검색 결과: <span className="font-semibold text-gray-900">{total.toLocaleString()}건</span>
          </p>
          <MedicationTable medications={results} loading={loading} />
        </div>
      )}
    </div>
  );
}
