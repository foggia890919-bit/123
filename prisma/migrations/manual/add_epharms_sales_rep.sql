-- 원내거래처 담당 영업사원 연결 (EpharmsAccount.salesRepId)
ALTER TABLE "EpharmsAccount"
  ADD COLUMN IF NOT EXISTS "salesRepId" TEXT REFERENCES "User"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "EpharmsAccount_salesRepId_idx" ON "EpharmsAccount"("salesRepId");
