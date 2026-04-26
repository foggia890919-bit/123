"use client";

import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

interface InventoryItem {
  insuranceCode: string;
  productName: string;
  spec: string | null;
  manufacturer: string | null;
  unitPrice: number | null;
  stock: number | null;
}

interface ScrapeRow {
  siteKey: string;
  insuranceCode: string;
  items: InventoryItem[];
  error?: string;
}

interface SiteInfo {
  key: string;
  name: string;
}

interface ItemRef {
  insuranceCode: string;
  productName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  items: ItemRef[];
}

export default function StockCheckBatchModal({ open, onClose, items }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ScrapeRow[]>([]);
  const [sites, setSites] = useState<SiteInfo[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/inventory/sites")
      .then(r => r.json())
      .then(data => setSites(data.sites ?? []))
      .catch(() => setSites([]));
  }, [open]);

  const run = () => {
    if (items.length === 0) return;
    setLoading(true);
    setError(null);
    setResults([]);
    const codes = Array.from(new Set(items.map(i => i.insuranceCode)));
    fetch("/api/inventory/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes }),
    })
      .then(async r => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(data => setResults(data.results ?? []))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // Group results: insuranceCode -> siteKey -> items
  const byCode: Record<string, Record<string, InventoryItem[]>> = {};
  const errorsByCode: Record<string, string[]> = {};
  for (const r of results) {
    if (r.error) {
      (errorsByCode[r.insuranceCode] ??= []).push(`${r.siteKey}: ${r.error}`);
    } else {
      ((byCode[r.insuranceCode] ??= {})[r.siteKey] ??= []).push(...r.items);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">실시간 재고 일괄 조회</h2>
            <p className="text-xs text-gray-500 mt-0.5">{items.length}개 품목 · 도매상 {sites.length}곳</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={run}
              disabled={loading}
              className="px-3 py-1.5 rounded text-sm border border-gray-200 hover:bg-gray-50 inline-flex items-center disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />다시 조회
            </button>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              도매상 {sites.length}곳에서 {items.length}개 품목 실시간 조회 중...
              <span className="ml-3 text-xs text-gray-400">예상: 약 {Math.ceil((items.length * sites.length * 2) / 60)}분</span>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-red-900">조회 실패</p>
                <p className="text-red-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && Object.keys(byCode).length > 0 && (
            <div className="space-y-3">
              {items.map(item => {
                const siteResults = byCode[item.insuranceCode] ?? {};
                const errs = errorsByCode[item.insuranceCode] ?? [];
                const totalItems = Object.values(siteResults).flat();
                const minPrice = totalItems.reduce<number | null>((acc, it) => {
                  if (it.unitPrice == null) return acc;
                  return acc == null || it.unitPrice < acc ? it.unitPrice : acc;
                }, null);
                return (
                  <div key={item.insuranceCode} className="border rounded-md">
                    <div className="px-4 py-2 bg-gray-50 border-b">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-gray-900 truncate">{item.productName}</div>
                        <div className="text-xs text-gray-500 font-mono shrink-0">{item.insuranceCode}</div>
                      </div>
                      {minPrice != null && (
                        <div className="text-xs text-emerald-700 mt-0.5">
                          최저가 {minPrice.toLocaleString()}원
                        </div>
                      )}
                    </div>
                    {totalItems.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-500">
                        {errs.length > 0 ? <span className="text-red-600">{errs.join("; ")}</span> : "결과 없음"}
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-white">
                          <tr className="text-xs text-gray-500 border-b">
                            <th className="text-left px-4 py-1.5">도매상</th>
                            <th className="text-left px-2 py-1.5">품목명</th>
                            <th className="text-left px-2 py-1.5">규격</th>
                            <th className="text-left px-2 py-1.5">제약회사</th>
                            <th className="text-right px-2 py-1.5">단가</th>
                            <th className="text-right px-4 py-1.5">재고</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(siteResults).flatMap(([siteKey, list]) =>
                            list.map((it, i) => {
                              const siteName = sites.find(s => s.key === siteKey)?.name ?? siteKey;
                              const isMin = minPrice != null && it.unitPrice === minPrice;
                              return (
                                <tr key={`${siteKey}-${i}`} className="border-b last:border-0">
                                  <td className="px-4 py-1.5 text-gray-700">{siteName}</td>
                                  <td className="px-2 py-1.5">{it.productName}</td>
                                  <td className="px-2 py-1.5 text-gray-600">{it.spec ?? "-"}</td>
                                  <td className="px-2 py-1.5 text-gray-600">{it.manufacturer ?? "-"}</td>
                                  <td className={`px-2 py-1.5 text-right tabular-nums ${isMin ? "font-semibold text-emerald-700" : ""}`}>
                                    {it.unitPrice != null ? it.unitPrice.toLocaleString() + "원" : "-"}
                                  </td>
                                  <td className="px-4 py-1.5 text-right tabular-nums font-medium">
                                    {it.stock != null
                                      ? <span className={it.stock > 0 ? "text-green-700" : "text-gray-400"}>{it.stock}</span>
                                      : "-"}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
              <div className="text-xs text-gray-500 flex items-center gap-1.5 pt-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                {new Date().toLocaleString("ko-KR")} 기준 실시간 데이터
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
