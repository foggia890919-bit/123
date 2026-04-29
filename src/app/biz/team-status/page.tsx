"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { RefreshCw, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { BizLayout } from "../page";

// ─────────────────────────────────────────────
// 정적 에이전트 프로파일
// ─────────────────────────────────────────────
const AGENT_PROFILES = [
  { name: "main-pm",                role: "PM (오케스트라)",    emoji: "🎩", model: "Opus 4.7"   },
  { name: "biz-user-mgmt",         role: "거래처/유저 관리",   emoji: "👨‍💼", model: "Sonnet 4.6" },
  { name: "biz-submission-routes", role: "통계제출처 관리",    emoji: "👩‍💼", model: "Sonnet 4.6" },
  { name: "biz-rates-mgmt",        role: "요율 관리",          emoji: "👨‍🔧", model: "Sonnet 4.6" },
  { name: "biz-settlement",        role: "정산 관리",          emoji: "👩‍💻", model: "Sonnet 4.6" },
  { name: "biz-filtering",         role: "필터링 관리",        emoji: "👨‍💻", model: "Sonnet 4.6" },
  { name: "biz-inventory-crawler", role: "재고 크롤러",        emoji: "🤖", model: "Sonnet 4.6" },
  { name: "biz-qa-crosscheck",     role: "QA 크로스체크",     emoji: "🕵️", model: "Sonnet 4.6" },
] as const;

// ─────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────
type AgentStatus = "idle" | "working" | "blocked" | "done";

interface RecentLog {
  id: string;
  status: string;
  currentTask: string | null;
  notes: string | null;
  createdAt: string;
}

interface AgentData {
  name: string;
  status: AgentStatus;
  currentTask: string | null;
  etaAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  notes: string | null;
  lastActivity: string | null;
  recentLogs: RecentLog[];
}

interface TeamStatusResponse {
  agents: AgentData[];
  activeETA: string | null;
}

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────
function timeAgo(iso: string | null): string {
  if (!iso) return "활동 없음";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  return `${Math.floor(hrs / 24)}일 전`;
}

function formatCountdown(etaIso: string | null): string {
  if (!etaIso) return "--:--:--";
  const diff = new Date(etaIso).getTime() - Date.now();
  if (diff <= 0) return "00:00:00";
  const totalSecs = Math.floor(diff / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function formatETALabel(etaIso: string | null): string {
  if (!etaIso) return "";
  return new Date(etaIso).toLocaleString("ko-KR", {
    month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle:    "대기",
  working: "작업중",
  blocked: "블로킹",
  done:    "완료",
};

const STATUS_BADGE: Record<AgentStatus, string> = {
  idle:    "bg-gray-100 text-gray-600",
  working: "bg-blue-100 text-blue-700 animate-pulse",
  blocked: "bg-red-100 text-red-700",
  done:    "bg-green-100 text-green-700",
};

const CARD_BG: Record<AgentStatus, string> = {
  idle:    "bg-gray-50 border-gray-200",
  working: "bg-blue-50 border-blue-300",
  blocked: "bg-red-50 border-red-300",
  done:    "bg-green-50 border-green-200",
};

// ─────────────────────────────────────────────
// 에이전트 카드
// ─────────────────────────────────────────────
function AgentCard({
  profile,
  data,
}: {
  profile: (typeof AGENT_PROFILES)[number];
  data: AgentData | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const status: AgentStatus = (data?.status as AgentStatus) ?? "idle";

  return (
    <div
      className={cn(
        "border rounded-2xl p-5 flex flex-col gap-3 transition-all duration-300",
        CARD_BG[status],
      )}
    >
      {/* 아바타 + 이름 */}
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "text-4xl select-none",
            status === "working"
              ? "animate-spin-slow"
              : "animate-wiggle",
          )}
          style={{ display: "inline-block" }}
          aria-hidden
        >
          {profile.emoji}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm leading-tight truncate">
            {profile.role}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{profile.model}</p>
        </div>
        <span
          className={cn(
            "text-xs font-semibold px-2 py-0.5 rounded-full shrink-0",
            STATUS_BADGE[status],
          )}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      {/* 현재 작업 */}
      {status === "working" && data?.currentTask && (
        <div className="bg-white/70 rounded-xl px-3 py-2 text-sm text-blue-800 font-medium truncate">
          {data.currentTask}
        </div>
      )}
      {status === "blocked" && data?.notes && (
        <div className="bg-white/70 rounded-xl px-3 py-2 text-sm text-red-700 flex items-start gap-1.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="truncate">{data.notes}</span>
        </div>
      )}

      {/* 마지막 활동 */}
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>{timeAgo(data?.lastActivity ?? null)}</span>
      </div>

      {/* 최근 로그 토글 */}
      {(data?.recentLogs?.length ?? 0) > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-gray-400 hover:text-gray-600 text-left underline underline-offset-2 w-fit"
        >
          {expanded ? "접기" : `최근 ${data!.recentLogs.length}건 보기`}
        </button>
      )}

      {expanded && (
        <ul className="space-y-1.5">
          {data!.recentLogs.map((log) => (
            <li
              key={log.id}
              className="bg-white/60 rounded-lg px-3 py-1.5 text-xs text-gray-600"
            >
              <span
                className={cn(
                  "inline-block mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold",
                  STATUS_BADGE[(log.status as AgentStatus) ?? "idle"],
                )}
              >
                {STATUS_LABEL[(log.status as AgentStatus) ?? "idle"]}
              </span>
              {log.currentTask ?? log.notes ?? "—"}
              <span className="ml-auto float-right text-gray-400">
                {timeAgo(log.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────────
export default function TeamStatusPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const [data, setData] = useState<TeamStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("--:--:--");
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const activeEtaRef = useRef<string | null>(null);

  // 인증 가드
  useEffect(() => {
    if (authStatus === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role as string;
    if (role !== "BIZ" && role !== "ADMIN") router.push("/");
  }, [session, authStatus, router]);

  // 데이터 페치
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/team-status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TeamStatusResponse = await res.json();
      setData(json);
      activeEtaRef.current = json.activeETA;
      setLastFetched(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  // 5초 polling
  useEffect(() => {
    fetchData();
    const poll = setInterval(fetchData, 5000);
    return () => clearInterval(poll);
  }, [fetchData]);

  // 1초 카운트다운
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown(formatCountdown(activeEtaRef.current));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  if (authStatus === "loading") return null;

  const agentMap = new Map<string, AgentData>(
    data?.agents.map((a) => [a.name, a]) ?? [],
  );

  const countdownColor =
    !data?.activeETA
      ? "text-gray-300"
      : new Date(data.activeETA).getTime() - Date.now() < 60 * 60 * 1000
      ? "text-red-500"
      : "text-blue-600";

  return (
    <BizLayout>
      <div className="space-y-6">
        {/* 헤더 */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">팀 상태 대시보드</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              8개 에이전트 작업 현황 · 5초 자동 갱신
              {lastFetched && (
                <span className="ml-2 text-gray-400">
                  ({lastFetched.toLocaleTimeString("ko-KR")} 기준)
                </span>
              )}
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            새로고침
          </button>
        </div>

        {/* 카운트다운 배너 */}
        <div className="bg-white border border-gray-200 rounded-2xl px-6 py-5 flex flex-col sm:flex-row items-center gap-2">
          <div className="flex-1 text-center sm:text-left">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              다음 보고 예상 시각
            </p>
            {data?.activeETA ? (
              <p className="text-sm text-gray-600 mt-0.5">
                {formatETALabel(data.activeETA)}
              </p>
            ) : (
              <p className="text-sm text-gray-400 mt-0.5">활성 작업 없음</p>
            )}
          </div>
          <p
            className={cn(
              "font-mono font-bold text-5xl tabular-nums tracking-tight transition-colors",
              countdownColor,
            )}
          >
            {countdown}
          </p>
        </div>

        {/* 에러 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* 에이전트 카드 그리드 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {AGENT_PROFILES.map((profile) => (
            <AgentCard
              key={profile.name}
              profile={profile}
              data={agentMap.get(profile.name)}
            />
          ))}
        </div>
      </div>
    </BizLayout>
  );
}
