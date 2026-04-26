-- ============================================================================
-- MASTER MIGRATION — run this ONCE in the Supabase SQL editor.
-- Safe to re-run: every statement uses IF NOT EXISTS / DROP NOT NULL guards.
-- ============================================================================

-- 1. LoginLog (security audit log)
CREATE TABLE IF NOT EXISTS "LoginLog" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT,
  "email"     TEXT NOT NULL,
  "success"   BOOLEAN NOT NULL,
  "ip"        TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LoginLog_createdAt_idx" ON "LoginLog"("createdAt");
CREATE INDEX IF NOT EXISTS "LoginLog_userId_idx"    ON "LoginLog"("userId");
CREATE INDEX IF NOT EXISTS "LoginLog_email_idx"     ON "LoginLog"("email");

-- 2. Medication.ingredientCode (HIRA 주성분코드, separate from 식약분류 categoryB)
ALTER TABLE "Medication" ADD COLUMN IF NOT EXISTS "ingredientCode" TEXT;
CREATE INDEX IF NOT EXISTS "Medication_ingredientCode_idx" ON "Medication"("ingredientCode");

-- 3. Performance indexes
CREATE INDEX IF NOT EXISTS "Medication_source_idx"           ON "Medication"("source");
CREATE INDEX IF NOT EXISTS "Medication_settlementType_idx"   ON "Medication"("settlementType");
CREATE INDEX IF NOT EXISTS "UserClient_approved_idx"         ON "UserClient"("approved");
CREATE INDEX IF NOT EXISTS "PrescriptionReport_status_idx"   ON "PrescriptionReport"("status");

-- 4. Supabase Storage migration columns
ALTER TABLE "UserDocument"       ADD COLUMN IF NOT EXISTS "fileKey"    TEXT;
ALTER TABLE "UserDocument"       ALTER COLUMN "fileData" DROP NOT NULL;
ALTER TABLE "UserClient"         ADD COLUMN IF NOT EXISTS "bizFileKey" TEXT;
ALTER TABLE "FilterRequest"      ADD COLUMN IF NOT EXISTS "bizFileKey" TEXT;
ALTER TABLE "PrescriptionReport" ADD COLUMN IF NOT EXISTS "imageKey"   TEXT;
