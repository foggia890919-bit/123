-- Add ingredientCode field: HIRA 주성분코드 (separate from categoryB = 식약분류)
ALTER TABLE "Medication" ADD COLUMN IF NOT EXISTS "ingredientCode" TEXT;
CREATE INDEX IF NOT EXISTS "Medication_ingredientCode_idx" ON "Medication"("ingredientCode");

-- Add LoginLog table for tracking user login activity
CREATE TABLE IF NOT EXISTS "LoginLog" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "userId"    TEXT,
  "email"     TEXT NOT NULL,
  "success"   BOOLEAN NOT NULL,
  "ip"        TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LoginLog_createdAt_idx" ON "LoginLog"("createdAt");
CREATE INDEX IF NOT EXISTS "LoginLog_userId_idx"    ON "LoginLog"("userId");
CREATE INDEX IF NOT EXISTS "LoginLog_email_idx"     ON "LoginLog"("email");
