ALTER TABLE "UserClient"
  ADD COLUMN IF NOT EXISTS "isSettlementTarget" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isRateTarget"        BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "UserClient_isSettlementTarget_idx" ON "UserClient"("isSettlementTarget");
CREATE INDEX IF NOT EXISTS "UserClient_isRateTarget_idx"        ON "UserClient"("isRateTarget");
