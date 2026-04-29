-- ============================================================================
-- INVENTORY INTEGRITY PATCH — run ONCE in the Supabase SQL editor (멱등 SQL).
-- Fixes:
--   1. Adds InventorySnapshot unique constraint (siteKey, insuranceCode, scrapedAt)
--      → prevents duplicate rows on crawler re-runs
--   2. Ensures WholesaleSite seed rows exist
--      → prevents FK violations when worker INSERTs without a prior ensureSite call
-- ============================================================================

-- 1. InventorySnapshot 유니크 제약
--    worker/src/db.ts의 INSERT ... ON CONFLICT (siteKey,insuranceCode,scrapedAt) DO NOTHING
--    이 동작하려면 이 제약이 반드시 존재해야 합니다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"InventorySnapshot"'::regclass
      AND conname = 'InventorySnapshot_siteKey_insuranceCode_scrapedAt_key'
  ) THEN
    ALTER TABLE "InventorySnapshot"
      ADD CONSTRAINT "InventorySnapshot_siteKey_insuranceCode_scrapedAt_key"
      UNIQUE ("siteKey", "insuranceCode", "scrapedAt");
  END IF;
END;
$$;

-- 2. WholesaleSite 시드 데이터 (FK 위반 방지)
--    worker가 startJob / saveSnapshots 전에 ensureSite()를 호출하지만,
--    DB가 초기 상태거나 테이블이 비어 있으면 아래 시드로 보장합니다.
INSERT INTO "WholesaleSite" ("key", "name", "baseUrl", "loginUrl", "active", "createdAt", "updatedAt")
VALUES
  ('ibjp',
   '백제약품',
   'https://ibjp.co.kr',
   'https://ibjp.co.kr/dist/login',
   true, NOW(), NOW()),
  ('inchun',
   '인천약품',
   'https://inchunpharm.com',
   'https://inchunpharm.com/Homepage/contents/login/login.asp',
   true, NOW(), NOW()),
  ('family',
   '훼밀리팜',
   'http://family-pharm.co.kr',
   'http://family-pharm.co.kr/member/',
   true, NOW(), NOW())
ON CONFLICT ("key") DO UPDATE
  SET "name"    = EXCLUDED."name",
      "baseUrl" = EXCLUDED."baseUrl",
      "loginUrl"= EXCLUDED."loginUrl",
      "updatedAt"= NOW();

-- 확인 쿼리 (주석 해제 후 실행):
-- SELECT * FROM "WholesaleSite";
-- SELECT COUNT(*) FROM "InventorySnapshot";
-- SELECT conname FROM pg_constraint
--   WHERE conrelid = '"InventorySnapshot"'::regclass AND contype = 'u';
