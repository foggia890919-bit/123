"use client";

import { useState, useEffect, useCallback } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Database,
  AlertTriangle,
  Play,
} from "lucide-react";

interface JobRow {
  id: string;
  siteKey: string;
  mode: string;
  totalCodes: number;
  doneCodes: number;
  failedCodes: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  successRate: number | null;
  durationMs: number | null;
}

interface SiteRow {
  key: string;
  name: string;
  active: boolean;
  latestSnapshotAt: string | null;
  snapshotCount: number;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 60_000) return `${Math.round(ms / 1000)}초`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}분 ${s}초`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "없음";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function InventoryStatusPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/inventory-status?limit=20");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setSites(Array.isArray(data.sites) ? data.sites : []);
    } catch (err) {
      console.error("[inventory-status] load failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function triggerBatch() {
    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL;
    setTriggering(true);
    setTriggerResult(null);
    try {
      // Trigger via the API route that proxies to the worker
      const res = await fetch("/api/inventory/sites");
      if (!res.ok) {
        setTriggerResult("Worker URL not configured — set WORKER_URL + WORKER_TOKEN in env");
        return;
      }
      const data = await res.json();
      // The worker /scrape-batch endpoint must be called directly by the server.
      // From the browser we can only show a message that tells the operator what to do.
      void workerUrl; // unused — kept for clarity
      setTriggerResult(
        "재시도 트리거는 서버 측 Worker URL을 통해 실행됩니다. " +
        "관리자가 WORKER_URL/scrape-batch POST 엔드포인트를 직접 호출하거나 " +
        "Worker 컨테이너에 /scrape-batch 를 POST 하세요. " +
        `(현재 등록된 사이트: ${Array.isArray(data.sites) ? data.sites.map((s: { key: string }) => s.key).join(", ") : "없음"})`
      );
    } catch (err) {
      setTriggerResult(`오류: ${(err as Error).message}`);
    } finally {
      setTriggering(false);
    }
  }

  return (
    <BizLayout>
      <div className="space-y-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">재고 크롤러 현황</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              WholesaleSite 별 최신 InventorySnapshot 갱신 시각 및 ScrapeJob 이력
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              새로고침
            </button>
            <button
              type="button"
              onClick={triggerBatch}
              disabled={triggering}
              className="flex items-center gap-1.5 text-sm bg-blue-600 text-white rounded-lg px-3 py-2 hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Play className="w-4 h-4" />
              {triggering ? "확인 중..." : "지금 재시도"}
            </button>
          </div>
        </div>

        {triggerResult && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{triggerResult}</span>
          </div>
        )}

        {/* 사이트별 최신 갱신 */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">사이트별 스냅샷 현황</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {loading && sites.length === 0 ? (
              <p className="text-sm text-gray-400 col-span-3">로딩 중...</p>
            ) : sites.length === 0 ? (
              <p className="text-sm text-gray-400 col-span-3">
                등록된 WholesaleSite 행이 없습니다. 크롤러를 최초 실행하거나 SQL 마이그레이션을 적용하세요.
              </p>
            ) : (
              sites.map(site => (
                <div
                  key={site.key}
                  className="bg-white border border-gray-200 rounded-xl p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900 text-sm">{site.name}</span>
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        site.active
                          ? "bg-green-50 text-green-700 border border-green-200"
                          : "bg-gray-100 text-gray-400 border border-gray-200"
                      }`}
                    >
                      {site.active ? "활성" : "비활성"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Database className="w-3.5 h-3.5" />
                    <span>{site.snapshotCount.toLocaleString()}건</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {site.latestSnapshotAt
                        ? `${formatRelative(site.latestSnapshotAt)} (${formatDateTime(site.latestSnapshotAt)})`
                        : "스냅샷 없음"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ScrapeJob 이력 */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">최근 ScrapeJob 이력 (최대 20건)</h2>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] text-gray-500 font-semibold">
                  <th className="px-3 py-2 text-left whitespace-nowrap">사이트</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">모드</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">전체</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">성공</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">실패</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">성공률</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">소요시간</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">시작</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">상태</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">오류</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading && jobs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-gray-400">
                      로딩 중...
                    </td>
                  </tr>
                ) : jobs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-gray-400">
                      ScrapeJob 기록이 없습니다. 크롤러가 아직 실행되지 않았거나 DATABASE_URL이 미설정 상태입니다.
                    </td>
                  </tr>
                ) : (
                  jobs.map(job => {
                    const isRunning = !job.finishedAt;
                    const hasError = !!job.error;
                    const rate = job.successRate;
                    return (
                      <tr key={job.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-medium text-gray-800">
                          {job.siteKey}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{job.mode}</td>
                        <td className="px-3 py-2 text-right text-gray-700 tabular-nums">
                          {job.totalCodes.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right text-green-700 tabular-nums font-medium">
                          {job.doneCodes.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <span className={job.failedCodes > 0 ? "text-red-600 font-medium" : "text-gray-400"}>
                            {job.failedCodes.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {rate !== null ? (
                            <span
                              className={
                                rate >= 90
                                  ? "text-green-700 font-semibold"
                                  : rate >= 70
                                  ? "text-amber-600 font-medium"
                                  : "text-red-600 font-medium"
                              }
                            >
                              {rate}%
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500 tabular-nums whitespace-nowrap">
                          {isRunning ? (
                            <span className="text-blue-500">진행 중</span>
                          ) : (
                            formatDuration(job.durationMs)
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                          {formatDateTime(job.startedAt)}
                        </td>
                        <td className="px-3 py-2">
                          {isRunning ? (
                            <span className="inline-flex items-center gap-1 text-blue-600">
                              <Clock className="w-3 h-3" /> 진행 중
                            </span>
                          ) : hasError ? (
                            <span className="inline-flex items-center gap-1 text-red-600">
                              <XCircle className="w-3 h-3" /> 오류
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-green-600">
                              <CheckCircle className="w-3 h-3" /> 완료
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-500 max-w-xs truncate">
                          {job.error ? (
                            <span className="text-red-500 text-[10px]" title={job.error}>
                              {job.error.slice(0, 80)}
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 운영 가이드 */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-600 space-y-1">
          <p className="font-semibold text-gray-700 mb-1">운영 참고</p>
          <p>• 크롤러(Worker)가 DATABASE_URL과 스크래퍼 인증정보(SCRAPER_*_ID/PW)를 갖고 있어야 스냅샷이 저장됩니다.</p>
          <p>• "지금 재시도" 버튼은 Worker URL 설정을 안내합니다. Worker의 <code className="font-mono bg-gray-100 px-1 rounded">/scrape-batch</code> 엔드포인트를 POST하면 즉시 배치가 시작됩니다.</p>
          <p>• InventorySnapshot은 14일 보존 후 자동 삭제됩니다 (pruneOldSnapshots 로직).</p>
          <p>• 재고가 통합검색에 표시되려면 Medication.insuranceCode와 InventorySnapshot.insuranceCode가 동일해야 합니다.</p>
        </div>
      </div>
    </BizLayout>
  );
}
