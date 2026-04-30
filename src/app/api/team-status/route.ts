import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isNextResponse } from "@/lib/auth-guard";

// 정적 에이전트 프로파일 — POST 시 등록 여부 검증에도 사용
const AGENT_NAMES = [
  "main-pm",
  "biz-user-mgmt",
  "biz-submission-routes",
  "biz-rates-mgmt",
  "biz-settlement",
  "biz-filtering",
  "biz-inventory-crawler",
  "biz-qa-crosscheck",
] as const;

type AgentName = (typeof AGENT_NAMES)[number];

// ─────────────────────────────────────────────
// GET /api/team-status
// 8명 에이전트의 최신 상태 + 최근 5건 로그 반환
// ─────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  // 각 에이전트의 최신 레코드 + 최근 5건
  const rows = await prisma.agentActivity.findMany({
    where: { agentName: { in: [...AGENT_NAMES] } },
    orderBy: { createdAt: "desc" },
  });

  // agentName → 레코드 배열 (이미 내림차순 정렬됨)
  const byAgent = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byAgent.has(r.agentName)) byAgent.set(r.agentName, []);
    byAgent.get(r.agentName)!.push(r);
  }

  const agents = AGENT_NAMES.map((name) => {
    const logs = byAgent.get(name) ?? [];
    const latest = logs[0];
    return {
      name,
      status: latest?.status ?? "idle",
      currentTask: latest?.currentTask ?? null,
      etaAt: latest?.etaAt?.toISOString() ?? null,
      startedAt: latest?.startedAt?.toISOString() ?? null,
      finishedAt: latest?.finishedAt?.toISOString() ?? null,
      notes: latest?.notes ?? null,
      lastActivity: latest?.updatedAt?.toISOString() ?? null,
      recentLogs: logs.slice(0, 5).map((l) => ({
        id: l.id,
        status: l.status,
        currentTask: l.currentTask,
        notes: l.notes,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  });

  // 활성 작업 중 가장 늦은 ETA
  const etas = agents
    .filter((a) => a.etaAt && a.status === "working")
    .map((a) => a.etaAt as string);
  const activeETA = etas.length > 0 ? etas.sort().at(-1) : null;

  return NextResponse.json({ agents, activeETA });
}

// ─────────────────────────────────────────────
// POST /api/team-status
// 에이전트 활동 기록 (오케스트라가 push)
// body: { agentName, status, currentTask?, etaAt?, notes? }
// ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  let body: {
    agentName?: string;
    status?: string;
    currentTask?: string | null;
    etaAt?: string | null;
    notes?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const { agentName, status, currentTask, etaAt, notes, startedAt, finishedAt } = body;

  if (!agentName || !status) {
    return NextResponse.json({ error: "agentName and status are required" }, { status: 400 });
  }

  if (!(AGENT_NAMES as readonly string[]).includes(agentName)) {
    return NextResponse.json({ error: "Unknown agentName" }, { status: 400 });
  }

  const validStatuses = ["idle", "working", "blocked", "done"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const record = await prisma.agentActivity.create({
    data: {
      agentName: agentName as AgentName,
      status,
      currentTask: currentTask ?? null,
      etaAt: etaAt ? new Date(etaAt) : null,
      startedAt: startedAt ? new Date(startedAt) : null,
      finishedAt: finishedAt ? new Date(finishedAt) : null,
      notes: notes ?? null,
    },
  });

  return NextResponse.json({ ok: true, id: record.id }, { status: 201 });
}
