-- 팀 상태 대시보드: 에이전트 활동 로그 테이블
-- 실행 방법: psql $DATABASE_URL -f prisma/migrations/manual/add_agent_activity.sql

CREATE TABLE IF NOT EXISTS "AgentActivity" (
  "id"          TEXT        PRIMARY KEY,
  "agentName"   TEXT        NOT NULL,
  "status"      TEXT        NOT NULL,           -- idle | working | blocked | done
  "currentTask" TEXT,
  "etaAt"       TIMESTAMPTZ,
  "startedAt"   TIMESTAMPTZ,
  "finishedAt"  TIMESTAMPTZ,
  "notes"       TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "AgentActivity_agentName_idx"  ON "AgentActivity"("agentName");
CREATE INDEX IF NOT EXISTS "AgentActivity_createdAt_idx"  ON "AgentActivity"("createdAt" DESC);
