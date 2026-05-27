-- 사업자 유형 평면화 — 상위법인/하위법인을 모두 일반 "법인" 으로 통합.
-- Supabase SQL Editor 에서 한 번 실행.
--
-- 배경: 상위/하위법인 계층 개념을 제거하기로 결정. 모든 법인은 동일한 "법인" 유형으로.

BEGIN;

-- UserClient: UPPER_CORP / LOWER_CORP → CORPORATION
UPDATE "UserClient"
SET "dealerType" = 'CORPORATION'
WHERE "dealerType" IN ('UPPER_CORP', 'LOWER_CORP');

-- 계층 관계(parentCorpId) 데이터 정리 — 더 이상 의미 없으므로 NULL 로
UPDATE "UserClient"
SET "parentCorpId" = NULL
WHERE "parentCorpId" IS NOT NULL;

-- 상위법인 공개 플래그 도 초기화
UPDATE "UserClient"
SET "isPublic" = false
WHERE "isPublic" = true;

COMMIT;

-- 확인:
-- SELECT "dealerType", COUNT(*) FROM "UserClient" GROUP BY "dealerType";
-- SELECT COUNT(*) AS "남은_계층_연결" FROM "UserClient" WHERE "parentCorpId" IS NOT NULL;
