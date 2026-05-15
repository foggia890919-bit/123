-- =============================================================
-- UserClient 테이블 컬럼 및 FK 추가
-- prisma/schema.prisma 변경 사항을 Supabase DB에 반영
-- =============================================================

-- parentCorpId 컬럼 추가 (없으면)
ALTER TABLE "UserClient"
  ADD COLUMN IF NOT EXISTS "parentCorpId" TEXT;

-- isPublic 컬럼 추가 (없으면)
ALTER TABLE "UserClient"
  ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- FK 제약 추가 (자기참조: 부모 법인 → UserClient)
ALTER TABLE "UserClient"
  ADD CONSTRAINT "UserClient_parentCorpId_fkey"
  FOREIGN KEY ("parentCorpId")
  REFERENCES "UserClient"("id")
  ON DELETE SET NULL;

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS "UserClient_parentCorpId_idx"
  ON "UserClient"("parentCorpId");
