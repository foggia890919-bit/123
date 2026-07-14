-- InventorySnapshot unique constraint 에 spec 추가
--
-- 이전: UNIQUE (siteKey, insuranceCode, scrapedAt)
--   → 같은 보험코드 안에 포장단위 다른 행(30T/500T)이 있을 때
--     createMany skipDuplicates 가 같은 scrapedAt 두 번째 행을 버려서
--     화면에 한 spec 만 노출되는 버그.
--
-- 변경: UNIQUE (siteKey, insuranceCode, spec, scrapedAt)
--   → spec 별로 별개 행으로 저장.
--   → NULLS NOT DISTINCT 로 spec=NULL 인 경우도 (site,code,scrapedAt) 기준
--     dedup 유지 (기존 동작 호환).

-- 1) 기존 unique constraint 제거
ALTER TABLE "InventorySnapshot"
  DROP CONSTRAINT IF EXISTS "InventorySnapshot_siteKey_insuranceCode_scrapedAt_key";

-- 2) 새 unique constraint 추가 (spec 포함, NULLS NOT DISTINCT)
ALTER TABLE "InventorySnapshot"
  ADD CONSTRAINT "InventorySnapshot_siteKey_insuranceCode_spec_scrapedAt_key"
  UNIQUE NULLS NOT DISTINCT ("siteKey", "insuranceCode", "spec", "scrapedAt");
