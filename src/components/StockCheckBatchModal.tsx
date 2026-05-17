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
            <h2 className="text-lg font-semibold text-gray-900">재고 일괄 조회</h2>
            <p className="text-xs text-gray-500 mt-0.5">{items.length}개 품목 · 도매상 합산</p>
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
              {items.length}개 품목 재고 조회 중...
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

          {!loading && !error && items.length > 0 && (
            <div className="space-y-3">
              <table className="w-full text-sm border rounded-md overflow-hidden">
                <thead className="bg-gray-50">
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="text-left px-4 py-2">품목명</th>
                    <th className="text-left px-2 py-2">보험코드</th>
                    <th className="text-left px-2 py-2">규격</th>
                    <th className="text-left px-2 py-2">제약회사</th>
                    <th className="text-right px-2 py-2">단가</th>
                    <th className="text-right px-4 py-2">재고 합계</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const siteResults = byCode[item.insuranceCode] ?? {};
                    const errs = errorsByCode[item.insuranceCode] ?? [];
                    const totalItems = Object.values(siteResults).flat();
                    const minPrice = totalItems.reduce<number | null>((acc, it) => {
                      if (it.unitPrice == null) return acc;
                      return acc == null || it.unitPrice < acc ? it.unitPrice : acc;
                    }, null);
                    const totalStock = totalItems.reduce((sum, it) => sum + (it.stock ?? 0), 0);
                    const displayName = totalItems.find(it => it.productName)?.productName ?? item.productName;
                    const displaySpec = totalItems.find(it => it.spec)?.spec ?? null;
                    const displayManufacturer = totalItems.find(it => it.manufacturer)?.manufacturer ?? null;
                    const noData = totalItems.length === 0;
                    return (
                      <tr key={item.insuranceCode} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-1.5">{displayName}</td>
                        <td className="px-2 py-1.5 text-gray-500 font-mono text-xs">{item.insuranceCode}</td>
                        <td className="px-2 py-1.5 text-gray-600">{displaySpec ?? "-"}</td>
                        <td className="px-2 py-1.5 text-gray-600">{displayManufacturer ?? "-"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {minPrice != null ? minPrice.toLocaleString() + "원" : "-"}
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums font-medium">
                          {noData
                            ? errs.length > 0
                              ? <span className="text-red-600 text-xs">오류</span>
                              : <span className="text-gray-300">-</span>
                            : <span className={totalStock > 0 ? "text-green-700" : "text-red-500"}>
                                {totalStock > 0 ? totalStock.toLocaleString() : "품절"}
                              </span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="text-xs text-gray-500 flex items-center gap-1.5 pt-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                보험코드 단위 도매상(백제·훼밀리) 재고 합산 · {new Date().toLocaleString("ko-KR")} 기준
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
