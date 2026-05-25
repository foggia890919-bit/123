-- 검색 속도 개선용 인덱스 — Supabase SQL Editor 에서 한 번 실행.
-- 이미 있으면 IF NOT EXISTS 가 알아서 스킵.

-- 1) 약품 마스터 검색 (제품명/성분명/제약사) 부분 일치 빠르게.
--    pg_trgm extension 활성화 후 GIN 인덱스 — ILIKE %text% 가 인덱스 사용 가능해진다.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Medication_productName_trgm"
  ON "Medication" USING gin ("productName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Medication_ingredientName_trgm"
  ON "Medication" USING gin ("ingredientName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Medication_companyName_trgm"
  ON "Medication" USING gin ("companyName" gin_trgm_ops);

-- 2) 재고 조회 — 보험코드로 검색할 때 빠르게 (이미 @@index([insuranceCode]) 있으면 무시)
CREATE INDEX IF NOT EXISTS "InventorySnapshot_insuranceCode_idx"
  ON "InventorySnapshot" ("insuranceCode");

-- 3) 통계 갱신 (Postgres 가 새 인덱스 활용하도록)
ANALYZE "Medication";
ANALYZE "InventorySnapshot";
