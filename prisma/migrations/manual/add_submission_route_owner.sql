-- SubmissionRoute.ownerId 추가 + unique 재설계
-- 운영 DB 에서 한 번만 실행. ADMIN user 가 1명 이상 있어야 backfill 성공.
-- 기존 row 는 ADMIN 소유로 backfill — API GET 측에서 ADMIN owned row 는 모든 회원에게 글로벌 master 로 노출.

DO $$
DECLARE
  admin_id TEXT;
BEGIN
  SELECT id INTO admin_id FROM "User" WHERE role='ADMIN' ORDER BY "createdAt" LIMIT 1;
  IF admin_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN user 가 0명입니다. backfill 불가. 관리자 1명 생성 후 재실행.';
  END IF;

  ALTER TABLE "SubmissionRoute" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;
  EXECUTE format('UPDATE "SubmissionRoute" SET "ownerId" = %L WHERE "ownerId" IS NULL', admin_id);
  ALTER TABLE "SubmissionRoute" ALTER COLUMN "ownerId" SET NOT NULL;
END $$;

-- FK
ALTER TABLE "SubmissionRoute"
  DROP CONSTRAINT IF EXISTS "SubmissionRoute_ownerId_fkey";
ALTER TABLE "SubmissionRoute"
  ADD CONSTRAINT "SubmissionRoute_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- 기존 unique 제거 + 새 compound unique
DROP INDEX IF EXISTS "SubmissionRoute_clientName_companyName_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionRoute_ownerId_clientName_companyName_key"
  ON "SubmissionRoute"("ownerId", "clientName", "companyName");

-- owner 조회용 인덱스
CREATE INDEX IF NOT EXISTS "SubmissionRoute_ownerId_idx" ON "SubmissionRoute"("ownerId");
