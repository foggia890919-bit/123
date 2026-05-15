-- =============================================================
-- 기존 데이터 회사명 정규화 마이그레이션
-- normalizeCompanyName() 로직을 SQL로 재현:
--   (주), 주식회사, (유), 유한회사, (재), (사), (합) 제거
--
-- 실행 전: BEGIN; 으로 트랜잭션 시작 후 결과 확인 → COMMIT 또는 ROLLBACK
-- =============================================================

BEGIN;

-- ─────────────────────────────────────────
-- 헬퍼 함수 (실행 후 DROP 가능)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION _normalize_company(name TEXT) RETURNS TEXT AS $$
BEGIN
  -- (주) 앞뒤 공백 포함 제거
  name := regexp_replace(name, '^\(주\)\s*', '');
  name := regexp_replace(name, '\s*\(주\)$', '');
  -- 주식회사 앞뒤 공백 포함 제거
  name := regexp_replace(name, '^주식회사\s+', '');
  name := regexp_replace(name, '\s+주식회사$', '');
  -- (유) 앞뒤 공백 포함 제거
  name := regexp_replace(name, '^\(유\)\s*', '');
  name := regexp_replace(name, '\s*\(유\)$', '');
  -- 유한회사 앞뒤 공백 포함 제거
  name := regexp_replace(name, '^유한회사\s+', '');
  name := regexp_replace(name, '\s+유한회사$', '');
  -- (재), (사), (합) 접두어 제거
  name := regexp_replace(name, '^\(재\)\s*', '');
  name := regexp_replace(name, '^\(사\)\s*', '');
  name := regexp_replace(name, '^\(합\)\s*', '');
  -- 앞뒤 공백 제거
  name := trim(name);
  RETURN name;
END;
$$ LANGUAGE plpgsql;


-- ─────────────────────────────────────────
-- 1. FilterRequest.clientName
--    (unique 제약 없음 — 단순 UPDATE)
-- ─────────────────────────────────────────
UPDATE "FilterRequest"
SET "clientName" = _normalize_company("clientName"),
    "updatedAt"  = now()
WHERE "clientName" != _normalize_company("clientName");


-- ─────────────────────────────────────────
-- 2. UserClient.clientName
--    (userId + bizNumber unique — clientName 자체는 unique 아님)
-- ─────────────────────────────────────────
UPDATE "UserClient"
SET "clientName" = _normalize_company("clientName")
WHERE "clientName" != _normalize_company("clientName");


-- ─────────────────────────────────────────
-- 3. Client.clientName (전역 거래처 풀)
--    (bizNumber unique — clientName 자체는 unique 아님)
-- ─────────────────────────────────────────
UPDATE "Client"
SET "clientName" = _normalize_company("clientName"),
    "updatedAt"  = now()
WHERE "clientName" != _normalize_company("clientName");


-- ─────────────────────────────────────────
-- 4. SubmissionRoute.clientName + companyName
--    @@unique([clientName, companyName]) 있음
--    정규화 후 충돌 시 최신 updatedAt 유지, 나머지 삭제
-- ─────────────────────────────────────────

-- 4-1. 충돌 예정 행 확인 (실행해서 0건이면 바로 UPDATE 가능)
SELECT
  _normalize_company("clientName")  AS norm_client,
  _normalize_company("companyName") AS norm_company,
  count(*)
FROM "SubmissionRoute"
GROUP BY norm_client, norm_company
HAVING count(*) > 1;

-- 4-2. 충돌하는 중복 제거 (최신 updatedAt 행만 유지)
DELETE FROM "SubmissionRoute"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY _normalize_company("clientName"),
                          _normalize_company("companyName")
             ORDER BY "updatedAt" DESC
           ) AS rn
    FROM "SubmissionRoute"
  ) ranked
  WHERE rn > 1
);

-- 4-3. 정규화 적용
UPDATE "SubmissionRoute"
SET "clientName"  = _normalize_company("clientName"),
    "companyName" = _normalize_company("companyName"),
    "updatedAt"   = now()
WHERE "clientName"  != _normalize_company("clientName")
   OR "companyName" != _normalize_company("companyName");


-- ─────────────────────────────────────────
-- 5. CorpCompanyRate.corpName + companyName
--    @@unique([corpName, companyName]) 있음
--    동일 전략: 중복 제거 → 정규화
-- ─────────────────────────────────────────

-- 5-1. 충돌 예정 행 확인
SELECT
  _normalize_company("corpName")    AS norm_corp,
  _normalize_company("companyName") AS norm_company,
  count(*)
FROM "CorpCompanyRate"
GROUP BY norm_corp, norm_company
HAVING count(*) > 1;

-- 5-2. 중복 제거 (최신 updatedAt 유지)
DELETE FROM "CorpCompanyRate"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY _normalize_company("corpName"),
                          _normalize_company("companyName")
             ORDER BY "updatedAt" DESC
           ) AS rn
    FROM "CorpCompanyRate"
  ) ranked
  WHERE rn > 1
);

-- 5-3. 정규화 적용
UPDATE "CorpCompanyRate"
SET "corpName"    = _normalize_company("corpName"),
    "companyName" = _normalize_company("companyName"),
    "updatedAt"   = now()
WHERE "corpName"    != _normalize_company("corpName")
   OR "companyName" != _normalize_company("companyName");


-- ─────────────────────────────────────────
-- 6. MemberCompanyRate.companyName
--    @@unique([userId, companyName]) 있음
-- ─────────────────────────────────────────

-- 6-1. 충돌 예정 확인
SELECT "userId", _normalize_company("companyName") AS norm_company, count(*)
FROM "MemberCompanyRate"
GROUP BY "userId", norm_company
HAVING count(*) > 1;

-- 6-2. 중복 제거 (최신 updatedAt 유지)
DELETE FROM "MemberCompanyRate"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY "userId", _normalize_company("companyName")
             ORDER BY "updatedAt" DESC
           ) AS rn
    FROM "MemberCompanyRate"
  ) ranked
  WHERE rn > 1
);

-- 6-3. 정규화 적용
UPDATE "MemberCompanyRate"
SET "companyName" = _normalize_company("companyName"),
    "updatedAt"   = now()
WHERE "companyName" != _normalize_company("companyName");


-- ─────────────────────────────────────────
-- 정리: 헬퍼 함수 삭제
-- ─────────────────────────────────────────
DROP FUNCTION _normalize_company(TEXT);

-- 결과 확인 후:
--   문제 없으면 → COMMIT;
--   롤백 필요 → ROLLBACK;

-- COMMIT;
