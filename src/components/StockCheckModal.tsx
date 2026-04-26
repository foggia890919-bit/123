"use client";

import { useCallback, useEffect, useState } from "react";
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
  durationMs?: number;
  scrapedAt?: string;
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
  const [source, setSource] = useState<"snapshot" | "live" | null>(null);

  const fetchData = useCallback(
    (live: boolean) => {
      if (!insuranceCode) return;
      setLoading(true);
      setError(null);
      setResults([]);
      const url = live ? "/api/inventory/check?live=1" : "/api/inventory/check";
      fetch(url, {
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
        .then(data => {
          setResults(data.results ?? []);
          setSource(data.source ?? null);
        })
        .catch(e => setError((e as Error).message))
        .finally(() => setLoading(false));
    },
    [insuranceCode]
  );

  useEffect(() => {
    if (!open || !insuranceCode) return;
    fetchData(false);
  }, [open, insuranceCode, fetchData]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">재고 조회</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              보험코드 <span className="font-mono">{insuranceCode}</span>
              {productName ? <> · {productName}</> : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData(true)}
              disabled={loading}
              title="지금 새로 조회 (느림 — 30초~1분)"
              className="text-xs flex items-center gap-1 px-2 py-1 rounded border text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
              지금 새로 조회
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
              {source === "live" ? "도매상에서 실시간 조회 중... (최대 5분)" : "조회 중..."}
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

          {!loading && !error && results.length > 0 && results.every(r => r.error === "no snapshot yet") && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-800">
              <p className="font-medium mb-1">아직 저장된 스냅샷이 없어요</p>
              <p>자동 스크래핑은 매일 06시 / 12시 / 18시 (KST)에 돌아요. 그 전까지는 우측 상단의 <b>지금 새로 조회</b>를 눌러주세요.</p>
            </div>
          )}

          {!loading && !error && results.length > 0 && !results.every(r => r.error === "no snapshot yet") && (() => {
            const validRows = results.filter(r => r.error !== "no snapshot yet");
            const errors = validRows.filter(r => r.error);
            const allItems = validRows.flatMap(r => r.items);
            const totalStock = allItems.reduce((sum, i) => sum + (i.stock ?? 0), 0);
            const aggregated = allItems.length > 0
              ? [{
                  productName: allItems.find(i => i.productName)?.productName ?? (productName ?? ""),
                  spec: allItems.find(i => i.spec)?.spec ?? null,
                  manufacturer: allItems.find(i => i.manufacturer)?.manufacturer ?? null,
                  unitPrice: allItems.find(i => i.unitPrice != null)?.unitPrice ?? null,
                  stock: totalStock,
                }]
              : [];
            return (
              <div className="space-y-4">
                <div className="border rounded-md">
                  {aggregated.length > 0 && (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr className="text-xs text-gray-500 border-b">
                          <th className="text-left px-4 py-2">품목명</th>
                          <th className="text-left px-2 py-2">규격</th>
                          <th className="text-left px-2 py-2">제약회사</th>
                          <th className="text-right px-2 py-2">단가</th>
                          <th className="text-right px-4 py-2">재고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aggregated.map((item, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-4 py-2">{item.productName}</td>
                            <td className="px-2 py-2 text-gray-600">{item.spec ?? "-"}</td>
                            <td className="px-2 py-2 text-gray-600">{item.manufacturer ?? "-"}</td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {item.unitPrice != null ? item.unitPrice.toLocaleString() + "원" : "-"}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums font-medium">
                              <span className={item.stock > 0 ? "text-green-700" : "text-gray-400"}>{item.stock}</span>
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
                <div className="text-xs text-gray-500 flex items-center gap-1.5 pt-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                  {source === "live" ? (
                    <>{new Date().toLocaleString("ko-KR")} 기준 실시간 데이터</>
                  ) : (
                    <>{formatLastUpdated(validRows)}</>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function formatLastUpdated(rows: ScrapeRow[]): string {
  const dates = rows
    .map(r => r.scrapedAt)
    .filter((s): s is string => !!s)
    .map(s => new Date(s));
  if (dates.length === 0) return "스냅샷 없음";
  const newest = new Date(Math.max(...dates.map(d => d.getTime())));
  const diffMs = Date.now() - newest.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHr = Math.round(diffMs / 3600000);
  let rel: string;
  if (diffMin < 60) rel = `${diffMin}분 전`;
  else if (diffHr < 24) rel = `${diffHr}시간 전`;
  else rel = `${Math.round(diffHr / 24)}일 전`;
  return `마지막 업데이트: ${newest.toLocaleString("ko-KR")} (${rel})`;
}
