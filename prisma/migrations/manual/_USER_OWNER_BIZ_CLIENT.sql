-- User.ownerBizClientId 컬럼 추가 + 기존 데이터에서 "본인 사업자" 자동 식별.
-- Supabase SQL Editor 에서 한 번 실행.
--
-- 배경: 그동안 "본인 사업자"와 "거래처(병원)"가 모두 UserClient(dealerType=null)
-- 한 테이블에 들어가 구분이 안 됨. 마이페이지에서 본인 사업자를 수정할 때
-- 다른 거래처와 충돌해서 오류가 발생.
-- 해결: User 에 ownerBizClientId 컬럼을 만들어서 명시적으로 본인 사업자를 가리킴.

BEGIN;

-- 1) 컬럼 추가 (nullable + unique)
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "ownerBizClientId" TEXT;

-- 2) 기존 데이터 보전: 각 사용자의 가장 오래된 본인-타입 거래처 (dealerType IS NULL)
--    를 ownerBizClientId 로 자동 설정.
WITH first_owner AS (
  SELECT DISTINCT ON ("userId") "userId", "id"
  FROM "UserClient"
  WHERE "dealerType" IS NULL
  ORDER BY "userId", "createdAt" ASC
)
UPDATE "User" u
SET "ownerBizClientId" = f.id
FROM first_owner f
WHERE u.id = f."userId"
  AND u."ownerBizClientId" IS NULL;

-- 3) UNIQUE 제약 + FK
ALTER TABLE "User"
  ADD CONSTRAINT "User_ownerBizClientId_key" UNIQUE ("ownerBizClientId");

ALTER TABLE "User"
  ADD CONSTRAINT "User_ownerBizClientId_fkey"
  FOREIGN KEY ("ownerBizClientId")
  REFERENCES "UserClient"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

COMMIT;

-- 확인 쿼리 (선택):
-- SELECT COUNT(*) AS "본인사업자_연결된_회원수" FROM "User" WHERE "ownerBizClientId" IS NOT NULL;
-- SELECT COUNT(*) AS "미연결_회원수" FROM "User" WHERE "ownerBizClientId" IS NULL;
