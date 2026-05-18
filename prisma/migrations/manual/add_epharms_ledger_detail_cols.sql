-- LedgerEntry 상세 컬럼 추가
-- account_detail URL로 전환하면서 추가된 필드들 (ediCode, spec, quantity, unitPrice)
-- 적용: Supabase SQL Editor에서 1회 실행.

ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "ediCode"   TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "spec"      TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "quantity"  INTEGER;
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "unitPrice" DECIMAL(18,2);
