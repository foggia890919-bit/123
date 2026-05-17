-- =============================================================
-- 기존 데이터 회사명 정규화 마이그레이션 (한 번에 실행)
-- updatedAt 없는 테이블(UserClient, SubmissionRoute) 대응 완료
-- =============================================================

-- 헬퍼 함수 생성
CREATE OR REPLACE FUNCTION _normalize_company(name TEXT) RETURNS TEXT AS $$
BEGIN
  name := regexp_replace(name, '^\(주\)\s*', '');
  name := regexp_replace(name, '\s*\(주\)$', '');
  name := regexp_replace(name, '^주식회사\s+', '');
  name := regexp_replace(name, '\s+주식회사$', '');
  name := regexp_replace(name, '^\(유\)\s*', '');
  name := regexp_replace(name, '\s*\(유\)$', '');
  name := regexp_replace(name, '^유한회사\s+', '');
  name := regexp_replace(name, '\s+유한회사$', '');
  name := regexp_replace(name, '^\(재\)\s*', '');
  name := regexp_replace(name, '^\(사\)\s*', '');
  name := regexp_replace(name, '^\(합\)\s*', '');
  name := trim(name);
  RETURN name;
END;
$$ LANGUAGE plpgsql;


-- ─────────────────────────────────────────
-- 1. FilterRequest.clientName (updatedAt 있음)
-- ─────────────────────────────────────────
UPDATE "FilterRequest"
SET "clientName" = _normalize_company("clientName"),
    "updatedAt"  = now()
WHERE "clientName" != _normalize_company("clientName");


-- ─────────────────────────────────────────
-- 2. UserClient.clientName (updatedAt 없음)
-- ─────────────────────────────────────────
UPDATE "UserClient"
SET "clientName" = _normalize_company("clientName")
WHERE "clientName" != _normalize_company("clientName");


-- ─────────────────────────────────────────
-- 3. Client.clientName (updatedAt 있음)
-- ─────────────────────────────────────────
UPDATE "Client"
SET "clientName" = _normalize_company("clientName"),
    "updatedAt"  = now()
WHERE "clientName" != _normalize_company("clientName");


-- ─────────────────────────────────────────
-- 4. SubmissionRoute (updatedAt 없음)
--    @@unique([clientName, companyName])
-- ─────────────────────────────────────────
DELETE FROM "SubmissionRoute"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY _normalize_company("clientName"),
                          _normalize_company("companyName")
             ORDER BY id DESC
           ) AS rn
    FROM "SubmissionRoute"
  ) t WHERE rn > 1
);

UPDATE "SubmissionRoute"
SET "clientName"  = _normalize_company("clientName"),
    "companyName" = _normalize_company("companyName")
WHERE "clientName"  != _normalize_company("clientName")
   OR "companyName" != _normalize_company("companyName");


-- ─────────────────────────────────────────
-- 5. CorpCompanyRate (updatedAt 있음)
--    @@unique([corpName, companyName])
-- ─────────────────────────────────────────
DELETE FROM "CorpCompanyRate"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY _normalize_company("corpName"),
                          _normalize_company("companyName")
             ORDER BY id DESC
           ) AS rn
    FROM "CorpCompanyRate"
  ) t WHERE rn > 1
);

UPDATE "CorpCompanyRate"
SET "corpName"    = _normalize_company("corpName"),
    "companyName" = _normalize_company("companyName"),
    "updatedAt"   = now()
WHERE "corpName"    != _normalize_company("corpName")
   OR "companyName" != _normalize_company("companyName");


-- ─────────────────────────────────────────
-- 6. MemberCompanyRate (updatedAt 있음)
--    @@unique([userId, companyName])
-- ─────────────────────────────────────────
DELETE FROM "MemberCompanyRate"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY "userId", _normalize_company("companyName")
             ORDER BY id DESC
           ) AS rn
    FROM "MemberCompanyRate"
  ) t WHERE rn > 1
);

UPDATE "MemberCompanyRate"
SET "companyName" = _normalize_company("companyName"),
    "updatedAt"   = now()
WHERE "companyName" != _normalize_company("companyName");


-- ─────────────────────────────────────────
-- 정리
-- ─────────────────────────────────────────
DROP FUNCTION _normalize_company(TEXT);
