-- ParentLinkRequest 모델 추가 — 하위 → 상위 매핑 요청/승인 workflow
-- 운영 DB 에서 한 번만 실행.

DO $$ BEGIN
  CREATE TYPE "ParentLinkStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ParentLinkRequest" (
  "id"                  TEXT             NOT NULL,
  "requesterId"         TEXT             NOT NULL,
  "targetId"            TEXT             NOT NULL,
  "targetEmailSnapshot" TEXT             NOT NULL,
  "status"              "ParentLinkStatus" NOT NULL DEFAULT 'PENDING',
  "decidedAt"           TIMESTAMP(3),
  "reason"              TEXT,
  "createdAt"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "ParentLinkRequest_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ParentLinkRequest"
  DROP CONSTRAINT IF EXISTS "ParentLinkRequest_requesterId_fkey";
ALTER TABLE "ParentLinkRequest"
  ADD CONSTRAINT "ParentLinkRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ParentLinkRequest"
  DROP CONSTRAINT IF EXISTS "ParentLinkRequest_targetId_fkey";
ALTER TABLE "ParentLinkRequest"
  ADD CONSTRAINT "ParentLinkRequest_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "ParentLinkRequest_requesterId_status_idx"
  ON "ParentLinkRequest"("requesterId", "status");
CREATE INDEX IF NOT EXISTS "ParentLinkRequest_targetId_status_idx"
  ON "ParentLinkRequest"("targetId", "status");

-- PENDING 중복 차단 — 한 user 에게서 동시에 PENDING 요청은 최대 1개
CREATE UNIQUE INDEX IF NOT EXISTS "ParentLinkRequest_requester_pending_uniq"
  ON "ParentLinkRequest"("requesterId") WHERE status = 'PENDING';
