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
  Wifi,
  WifiOff,
  KeyRound,
  Activity,
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

interface WorkerSiteInfo {
  key: string;
  name: string;
  hasCredentials: boolean;
  activeSession: boolean;
}

interface WorkerDiag {
  workerConfigured: boolean;
  workerReachable?: boolean;
  jobRunning?: boolean | null;
  dbConfigured?: boolean | null;
  reason?: string;
  sites: WorkerSiteInfo[];
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
  const [triggerResult, setTriggerResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [workerDiag, setWorkerDiag] = useState<WorkerDiag | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

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

  const loadWorkerDiag = useCallback(async () => {
    setDiagLoading(true);
    try {
      const res = await fetch("/api/admin/inventory-trigger");
      if (!res.ok && res.status !== 503) {
        setWorkerDiag({ workerConfigured: false, reason: `HTTP ${res.status}`, sites: [] });
        return;
      }
      const data = await res.json();
      setWorkerDiag(data);
    } catch (err) {
      setWorkerDiag({
        workerConfigured: false,
        reason: (err as Error).message,
        sites: [],
      });
    } finally {
      setDiagLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadWorkerDiag();
  }, [load, loadWorkerDiag]);

  async function triggerBatch() {
    setTriggering(true);
    setTriggerResult(null);
    try {
      const res = await fetch("/api/admin/inventory-trigger", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setTriggerResult({ ok: false, msg: "이미 실행 중인 배치가 있습니다. 완료 후 재시도하세요." });
      } else if (!res.ok) {
        setTriggerResult({
          ok: false,
          msg: `오류: ${data?.error ?? `HTTP ${res.status}`}`,
        });
      } else {
        setTriggerResult({
          ok: true,
          msg: "배치가 시작되었습니다. 완료 후 새로고침하면 결과를 확인할 수 있습니다.",
        });
        // Refresh status after a short delay to pick up the new ScrapeJob rows
        setTimeout(() => { void load(); void loadWorkerDiag(); }, 3_000);
      }
    } catch (err) {
      setTriggerResult({ ok: false, msg: `오류: ${(err as Error).message}` });
    } finally {
      setTriggering(false);
    }
  }

  const workerOk = workerDiag?.workerConfigured && workerDiag?.workerReachable;
  const missingCreds = workerDiag?.sites.filter(s => !s.hasCredentials) ?? [];
  const hasCreds = workerDiag?.sites.filter(s => s.hasCredentials) ?? [];

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
              onClick={() => { void load(); void loadWorkerDiag(); }}
              disabled={loading || diagLoading}
              className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${(loading || diagLoading) ? "animate-spin" : ""}`} />
              새로고침
            </button>
            <button
              type="button"
              onClick={() => void triggerBatch()}
              disabled={triggering || !workerOk}
              title={!workerOk ? "Worker가 연결되지 않았습니다. 아래 진단 섹션을 확인하세요." : ""}
              className="flex items-center gap-1.5 text-sm bg-blue-600 text-white rounded-lg px-3 py-2 hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Play className="w-4 h-4" />
              {triggering ? "시작 중..." : "지금 재시도"}
            </button>
          </div>
        </div>

        {triggerResult && (
          <div
            className={`border rounded-lg p-3 text-sm flex items-start gap-2 ${
              triggerResult.ok
                ? "bg-green-50 border-green-200 text-green-800"
                : "bg-amber-50 border-amber-200 text-amber-800"
            }`}
          >
            {triggerResult.ok ? (
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{triggerResult.msg}</span>
          </div>
        )}

        {/* Worker 진단 카드 */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
            <Activity className="w-4 h-4" />
            Worker 진단
          </h2>
          {diagLoading && !workerDiag ? (
            <p className="text-sm text-gray-400">진단 정보 로딩 중...</p>
          ) : workerDiag ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 연결 상태 */}
              <div className="border rounded-xl p-4 bg-white space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Worker 연결</p>
                {!workerDiag.workerConfigured ? (
                  <div className="flex items-center gap-2 text-red-600">
                    <WifiOff className="w-4 h-4" />
                    <span className="text-sm font-medium">미설정</span>
                  </div>
                ) : workerDiag.workerReachable === false ? (
                  <div className="flex items-center gap-2 text-red-600">
                    <WifiOff className="w-4 h-4" />
                    <span className="text-sm font-medium">연결 실패</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-green-600">
                    <Wifi className="w-4 h-4" />
                    <span className="text-sm font-medium">연결됨</span>
                  </div>
                )}
                {workerDiag.reason && (
                  <p className="text-xs text-red-500 break-all">{workerDiag.reason}</p>
                )}
                {workerDiag.dbConfigured !== null && workerDiag.dbConfigured !== undefined && (
                  <p className={`text-xs ${workerDiag.dbConfigured ? "text-green-600" : "text-red-500"}`}>
                    {workerDiag.dbConfigured ? "DATABASE_URL 설정됨" : "DATABASE_URL 미설정 — 스케줄러 비활성"}
                  </p>
                )}
                {workerDiag.jobRunning === true && (
                  <p className="text-xs text-blue-600 font-medium">배치 실행 중...</p>
                )}
                {!workerDiag.workerConfigured && (
                  <div className="text-xs text-gray-500 space-y-0.5 pt-1 border-t border-gray-100">
                    <p className="font-medium text-gray-600">설정 방법:</p>
                    <p>Vercel 환경변수에 다음 추가:</p>
                    <code className="block bg-gray-100 rounded px-1.5 py-1 font-mono text-[11px] break-all">
                      WORKER_URL=http://&lt;lightsail-ip&gt;:8080
                    </code>
                    <code className="block bg-gray-100 rounded px-1.5 py-1 font-mono text-[11px]">
                      WORKER_TOKEN=&lt;32자리 토큰&gt;
                    </code>
                  </div>
                )}
              </div>

              {/* 자격증명 상태 */}
              <div className="border rounded-xl p-4 bg-white space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                  <KeyRound className="w-3.5 h-3.5" /> 사이트 자격증명 (Worker 측)
                </p>
                {workerDiag.sites.length === 0 && !workerDiag.workerReachable ? (
                  <p className="text-xs text-gray-400">Worker 연결 후 확인 가능</p>
                ) : workerDiag.sites.length === 0 ? (
                  <p className="text-xs text-gray-400">등록된 사이트 없음</p>
                ) : (
                  <div className="space-y-1.5">
                    {workerDiag.sites.map(s => (
                      <div key={s.key} className="flex items-center gap-2">
                        {s.hasCredentials ? (
                          <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        )}
                        <span className={`text-xs font-mono ${s.hasCredentials ? "text-gray-700" : "text-red-500"}`}>
                          {s.key}
                        </span>
                        <span className="text-xs text-gray-400">({s.name})</span>
                        {!s.hasCredentials && (
                          <code className="text-[10px] bg-red-50 text-red-500 px-1 rounded ml-auto">
                            SCRAPER_{s.key.toUpperCase()}_ID/PW 미설정
                          </code>
                        )}
                      </div>
                    ))}
                    {missingCreds.length > 0 && (
                      <p className="text-[11px] text-red-500 pt-1 border-t border-gray-100">
                        자격증명 미설정 사이트는 크롤링이 건너뜀. Worker의 .env에 추가하거나 환경변수를 주입하세요.
                      </p>
                    )}
                    {hasCreds.length === 0 && workerDiag.sites.length > 0 && (
                      <p className="text-xs text-red-600 font-medium pt-1 border-t border-gray-100">
                        모든 사이트에 자격증명 없음 — 크롤러가 아무것도 실행하지 않습니다.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

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
              sites.map(site => {
                const isSuspended = site.key === "inchun";
                return (
                  <div
                    key={site.key}
                    className={`border rounded-xl p-4 space-y-2 ${
                      isSuspended
                        ? "bg-gray-50 border-gray-200 opacity-70"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className={`font-semibold text-sm ${isSuspended ? "text-gray-400" : "text-gray-900"}`}>
                        {site.name}
                      </span>
                      {isSuspended ? (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-300 whitespace-nowrap">
                          일시 중단 — 로그인 팝업 이슈
                        </span>
                      ) : (
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                            site.active
                              ? "bg-green-50 text-green-700 border border-green-200"
                              : "bg-gray-100 text-gray-400 border border-gray-200"
                          }`}
                        >
                          {site.active ? "활성" : "비활성"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <Database className="w-3.5 h-3.5" />
                      <span>{site.snapshotCount.toLocaleString()}건</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <Clock className="w-3.5 h-3.5" />
                      <span>
                        {site.latestSnapshotAt
                          ? `마지막 성공: ${formatRelative(site.latestSnapshotAt)} (${formatDateTime(site.latestSnapshotAt)})`
                          : "스냅샷 없음"}
                      </span>
                    </div>
                    {isSuspended && (
                      <p className="text-[10px] text-gray-400 leading-relaxed">
                        팝업 자동 닫기 미구현. 향후 P2 작업으로 dialog handler + 모달 dismiss 구현 예정.
                      </p>
                    )}
                  </div>
                );
              })
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
          <p>• Worker(Lightsail)가 실행 중이어야 합니다. <code className="font-mono bg-gray-100 px-1 rounded">worker/scripts/install-lightsail.sh</code> 로 배포.</p>
          <p>• Vercel 환경변수: <code className="font-mono bg-gray-100 px-1 rounded">WORKER_URL</code> + <code className="font-mono bg-gray-100 px-1 rounded">WORKER_TOKEN</code> 설정 필요.</p>
          <p>• Worker의 <code className="font-mono bg-gray-100 px-1 rounded">.env</code> 에 자격증명 추가: <code className="font-mono bg-gray-100 px-1 rounded">SCRAPER_IBJP_ID/PW</code>, <code className="font-mono bg-gray-100 px-1 rounded">SCRAPER_FAMILY_ID/PW</code>.</p>
          <p>• <code className="font-mono bg-gray-100 px-1 rounded">DATABASE_URL</code> 을 Worker의 .env에도 설정해야 스냅샷이 저장됩니다 (Supabase 커넥션 문자열).</p>
          <p>• 스케줄: KST 06:00 / 12:00 / 18:00 자동 실행. 위 "지금 재시도" 버튼으로 즉시 실행 가능.</p>
          <p>• InventorySnapshot은 14일 보존 후 자동 삭제됩니다.</p>
          <p>• 재고가 통합검색에 표시되려면 <code className="font-mono bg-gray-100 px-1 rounded">Medication.insuranceCode</code> 와 <code className="font-mono bg-gray-100 px-1 rounded">InventorySnapshot.insuranceCode</code> 가 동일해야 합니다.</p>
        </div>
      </div>
    </BizLayout>
  );
}
