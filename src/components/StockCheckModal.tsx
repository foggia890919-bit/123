"use client";

import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

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
  durationMs: number;
}

interface SiteInfo {
  key: string;
  name: string;
  hasCredentials: boolean;
  activeSession: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  insuranceCode: string | null;
  productName?: string | null;
}

export default function StockCheckModal({ open, onClose, insuranceCode, productName }: Props) {
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

  useEffect(() => {
    if (!open || !insuranceCode) return;
    setLoading(true);
    setError(null);
    setResults([]);
    fetch("/api/inventory/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: [insuranceCode] }),
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
  }, [open, insuranceCode]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">실시간 재고 조회</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              보험코드 <span className="font-mono">{insuranceCode}</span>
              {productName ? <> · {productName}</> : null}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              도매상에서 실시간 조회 중... (최대 1분)
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

          {!loading && !error && results.length > 0 && (
            <div className="space-y-4">
              {Object.entries(groupBySite(results)).map(([siteKey, rows]) => {
                const siteName = sites.find(s => s.key === siteKey)?.name ?? siteKey;
                const allItems = rows.flatMap(r => r.items);
                const errors = rows.filter(r => r.error);
                return (
                  <div key={siteKey} className="border rounded-md">
                    <div className="px-4 py-2 bg-gray-50 border-b flex items-center justify-between">
                      <span className="font-medium text-gray-900">{siteName}</span>
                      <span className="text-xs text-gray-500">
                        {allItems.length > 0
                          ? `${allItems.length}건`
                          : errors.length > 0
                            ? <span className="text-red-600">오류</span>
                            : "결과 없음"}
                      </span>
                    </div>
                    {allItems.length > 0 && (
                      <table className="w-full text-sm">
                        <thead className="bg-white">
                          <tr className="text-xs text-gray-500 border-b">
                            <th className="text-left px-4 py-2">품목명</th>
                            <th className="text-left px-2 py-2">규격</th>
                            <th className="text-left px-2 py-2">제약회사</th>
                            <th className="text-right px-2 py-2">단가</th>
                            <th className="text-right px-4 py-2">재고</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allItems.map((item, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="px-4 py-2">{item.productName}</td>
                              <td className="px-2 py-2 text-gray-600">{item.spec ?? "-"}</td>
                              <td className="px-2 py-2 text-gray-600">{item.manufacturer ?? "-"}</td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {item.unitPrice != null ? item.unitPrice.toLocaleString() + "원" : "-"}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums font-medium">
                                {item.stock != null
                                  ? <span className={item.stock > 0 ? "text-green-700" : "text-gray-400"}>{item.stock}</span>
                                  : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {errors.length > 0 && (
                      <div className="px-4 py-2 text-xs text-red-700">{errors.map(e => e.error).join("; ")}</div>
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

function groupBySite(rows: ScrapeRow[]): Record<string, ScrapeRow[]> {
  const out: Record<string, ScrapeRow[]> = {};
  for (const r of rows) (out[r.siteKey] ??= []).push(r);
  return out;
}
