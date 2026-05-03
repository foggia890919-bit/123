"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Loader2, AlertCircle, CheckCircle2, RefreshCw, AlertTriangle, Info } from "lucide-react";

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
            <NoSnapshotBanner onLive={() => fetchData(true)} />
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

// ── NoSnapshotBanner ────────────────────────────────────────────────────────
// Fetches /api/admin/inventory-status to determine *why* the snapshot is empty
// and shows a specific, actionable message for each root-cause scenario.

interface DiagInfo {
  tableExists: boolean;
  scrapeJobCount24h: number;
  scrapeJobSuccessCount24h: number;
  scrapeJobFailedCount24h: number;
  snapshotCount24h: number;
  workerEnvConfigured: boolean;
  diagMessage: string;
}

function NoSnapshotBanner({ onLive }: { onLive: () => void }) {
  const [diag, setDiag] = useState<DiagInfo | null>(null);

  useEffect(() => {
    fetch("/api/admin/inventory-status?limit=1")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.diag) setDiag(data.diag as DiagInfo);
      })
      .catch(() => {/* best-effort */});
  }, []);

  // Derive specific guidance from diagnostic data
  let title = "아직 저장된 스냅샷이 없어요";
  let body: React.ReactNode;
  let icon = <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />;
  let colorClass = "bg-amber-50 border-amber-200 text-amber-800";

  if (diag) {
    if (!diag.tableExists) {
      title = "DB 마이그레이션이 필요합니다";
      body = (
        <>
          <span>InventorySnapshot 테이블이 없습니다. Supabase에서 </span>
          <code className="font-mono text-xs bg-amber-100 px-1 rounded">_MASTER_MIGRATION.sql</code>
          <span>을 실행해주세요.</span>
        </>
      );
      icon = <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />;
      colorClass = "bg-red-50 border-red-200 text-red-800";
    } else if (diag.scrapeJobCount24h === 0) {
      title = "Worker가 아직 실행되지 않았습니다";
      body = (
        <>
          24시간 내 크롤 작업 기록이 없습니다.{" "}
          {diag.workerEnvConfigured
            ? "WORKER_URL은 설정됐지만 Worker 프로세스가 실행 중이지 않을 수 있습니다."
            : "Vercel 환경변수에 WORKER_URL과 WORKER_TOKEN을 설정하고 Lightsail 워커를 실행하세요."}{" "}
          <a href="/biz/inventory-status" className="underline font-medium">재고 크롤러 현황</a>에서 설정 상태를 확인하세요.
        </>
      );
      icon = <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />;
      colorClass = "bg-red-50 border-red-200 text-red-800";
    } else if (diag.scrapeJobSuccessCount24h === 0) {
      title = "최근 크롤 시도가 모두 실패했습니다";
      body = (
        <>
          최근 24h {diag.scrapeJobCount24h}건 시도 중 성공 0건.{" "}
          <a href="/biz/inventory-status" className="underline font-medium">재고 크롤러 현황</a>에서 에러 메시지를 확인하세요.
          자격증명(SCRAPER_*_ID/PW) 또는 사이트 접속 이슈일 수 있습니다.
        </>
      );
      icon = <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />;
      colorClass = "bg-red-50 border-red-200 text-red-800";
    } else if (diag.snapshotCount24h === 0) {
      title = "크롤은 성공했지만 스냅샷이 저장되지 않았습니다";
      body = (
        <>
          Worker에서 크롤은 완료됐지만 InventorySnapshot에 데이터가 없습니다.
          Worker의 DATABASE_URL 미설정 또는 어댑터 파싱 결함일 수 있습니다.{" "}
          <a href="/biz/inventory-status" className="underline font-medium">재고 크롤러 현황</a>을 확인하세요.
        </>
      );
      icon = <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />;
    } else {
      // snapshots exist globally but not for this specific code
      body = (
        <>
          이 보험코드에 대한 스냅샷이 아직 없습니다. 자동 크롤링은 매일 06시 / 12시 / 18시 (KST)에 실행됩니다.
          지금 바로 조회하려면 우측 상단의{" "}
          <button onClick={onLive} className="underline font-medium">지금 새로 조회</button>를 누르세요.
        </>
      );
      icon = <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />;
    }
  } else {
    // Diag not loaded yet or admin API inaccessible (non-biz user)
    body = (
      <>
        자동 스크래핑은 매일 06시 / 12시 / 18시 (KST)에 돌아요. 그 전까지는 우측 상단의{" "}
        <button onClick={onLive} className="underline font-medium">지금 새로 조회</button>를 눌러주세요.
      </>
    );
  }

  return (
    <div className={`border rounded-md p-4 text-sm flex items-start gap-2.5 ${colorClass}`}>
      {icon}
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="leading-relaxed">{body}</p>
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
