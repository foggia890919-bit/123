-- InventorySnapshot: 누적 → 덮어쓰기 방식 전환
-- 한 번만 실행. Supabase SQL Editor 에서.
--
-- 변경 내용:
--   - 같은 (siteKey, insuranceCode) 조합은 가장 최신 한 줄만 남김
--   - 그 다음부터는 워커/라이브 호출이 같은 키에 대해 덮어쓰도록 UNIQUE 제약 변경

BEGIN;

-- 1) 중복 줄 정리 — 각 (siteKey, insuranceCode)별 가장 최신 scrapedAt만 남기고 나머지 삭제
DELETE FROM "InventorySnapshot" a
USING "InventorySnapshot" b
WHERE a."siteKey" = b."siteKey"
  AND a."insuranceCode" = b."insuranceCode"
  AND (
    a."scrapedAt" < b."scrapedAt"
    OR (a."scrapedAt" = b."scrapedAt" AND a."id" < b."id")
  );

-- 2) 기존 UNIQUE 제약 (siteKey, insuranceCode, scrapedAt) 제거
ALTER TABLE "InventorySnapshot"
  DROP CONSTRAINT IF EXISTS "InventorySnapshot_siteKey_insuranceCode_scrapedAt_key";

-- 3) 새 UNIQUE 제약 (siteKey, insuranceCode) 추가
ALTER TABLE "InventorySnapshot"
  ADD CONSTRAINT "InventorySnapshot_siteKey_insuranceCode_key"
  UNIQUE ("siteKey", "insuranceCode");

-- 4) 더 이상 필요 없는 보조 인덱스 정리 (UNIQUE 가 같은 컬럼 커버)
DROP INDEX IF EXISTS "InventorySnapshot_siteKey_insuranceCode_idx";

COMMIT;

-- 확인 쿼리
-- SELECT COUNT(*) FROM "InventorySnapshot";
-- SELECT "siteKey", "insuranceCode", COUNT(*)
-- FROM "InventorySnapshot"
-- GROUP BY 1, 2
-- HAVING COUNT(*) > 1;
-- → 결과 0건 이면 정상 (중복 없음)
