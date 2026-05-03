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

-- 5. Inventory crawler tables (WholesaleSite, InventorySnapshot, ScrapeJob)
--    Worker writes InventorySnapshot rows; web reads them for stock display.

CREATE TABLE IF NOT EXISTS "WholesaleSite" (
  "key"       TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "baseUrl"   TEXT NOT NULL,
  "loginUrl"  TEXT NOT NULL,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "note"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "InventorySnapshot" (
  "id"            TEXT PRIMARY KEY,
  "siteKey"       TEXT NOT NULL,
  "insuranceCode" TEXT NOT NULL,
  "productName"   TEXT,
  "spec"          TEXT,
  "manufacturer"  TEXT,
  "unitPrice"     INTEGER,
  "stock"         INTEGER,
  "raw"           JSONB,
  "scrapedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventorySnapshot_siteKey_fkey"
    FOREIGN KEY ("siteKey") REFERENCES "WholesaleSite"("key")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Unique constraint required by ON CONFLICT clause in worker/src/db.ts saveSnapshots.
-- Without this the INSERT ... ON CONFLICT (...) DO NOTHING raises an error.
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

CREATE INDEX IF NOT EXISTS "InventorySnapshot_insuranceCode_idx"
  ON "InventorySnapshot"("insuranceCode");
CREATE INDEX IF NOT EXISTS "InventorySnapshot_siteKey_insuranceCode_idx"
  ON "InventorySnapshot"("siteKey", "insuranceCode");
CREATE INDEX IF NOT EXISTS "InventorySnapshot_scrapedAt_idx"
  ON "InventorySnapshot"("scrapedAt");

CREATE TABLE IF NOT EXISTS "ScrapeJob" (
  "id"          TEXT PRIMARY KEY,
  "siteKey"     TEXT NOT NULL,
  "mode"        TEXT NOT NULL,
  "totalCodes"  INTEGER NOT NULL,
  "doneCodes"   INTEGER NOT NULL DEFAULT 0,
  "failedCodes" INTEGER NOT NULL DEFAULT 0,
  "startedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"  TIMESTAMP(3),
  "error"       TEXT
);
CREATE INDEX IF NOT EXISTS "ScrapeJob_siteKey_startedAt_idx"
  ON "ScrapeJob"("siteKey", "startedAt");

-- Seed WholesaleSite rows so the FK constraint on InventorySnapshot never fails
-- on a freshly provisioned DB (worker also calls ensureSite() before each run).
INSERT INTO "WholesaleSite" ("key", "name", "baseUrl", "loginUrl", "active", "createdAt", "updatedAt")
VALUES
  ('ibjp',   '백제약품',  'https://ibjp.co.kr',        'https://ibjp.co.kr/dist/login',                                  true, NOW(), NOW()),
  ('inchun', '인천약품',  'https://inchunpharm.com',   'https://inchunpharm.com/Homepage/contents/login/login.asp',      true, NOW(), NOW()),
  ('family', '훼밀리팜',  'http://family-pharm.co.kr', 'http://family-pharm.co.kr/member/',                             true, NOW(), NOW())
ON CONFLICT ("key") DO UPDATE
  SET "name"      = EXCLUDED."name",
      "baseUrl"   = EXCLUDED."baseUrl",
      "loginUrl"  = EXCLUDED."loginUrl",
      "updatedAt" = NOW();

-- 자동 메일 수신
CREATE TABLE IF NOT EXISTS "IncomingEmail" (
  "id"                TEXT PRIMARY KEY,
  "messageId"         TEXT NOT NULL UNIQUE,
  "fromAddress"       TEXT NOT NULL,
  "fromName"          TEXT,
  "subject"           TEXT NOT NULL,
  "bodyPreview"       TEXT,
  "receivedAt"        TIMESTAMPTZ NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "classifiedAs"      TEXT,
  "mappedCorpId"      TEXT,
  "mappedCompanyName" TEXT,
  "applyMonth"        TEXT,
  "processedAt"       TIMESTAMPTZ,
  "processedById"     TEXT,
  "rateFileId"        TEXT,
  "settlementDocId"   TEXT,
  "errorMessage"      TEXT,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "IncomingEmail_processedById_fkey"
    FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "IncomingEmail_status_idx"      ON "IncomingEmail"("status");
CREATE INDEX IF NOT EXISTS "IncomingEmail_receivedAt_idx"  ON "IncomingEmail"("receivedAt" DESC);
CREATE INDEX IF NOT EXISTS "IncomingEmail_fromAddress_idx" ON "IncomingEmail"("fromAddress");

CREATE TABLE IF NOT EXISTS "EmailAttachment" (
  "id"        TEXT PRIMARY KEY,
  "emailId"   TEXT NOT NULL,
  "fileName"  TEXT NOT NULL,
  "mimeType"  TEXT NOT NULL,
  "size"      INTEGER NOT NULL,
  "fileKey"   TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "EmailAttachment_emailId_fkey"
    FOREIGN KEY ("emailId") REFERENCES "IncomingEmail"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "EmailAttachment_emailId_idx" ON "EmailAttachment"("emailId");

CREATE TABLE IF NOT EXISTS "EmailSenderMapping" (
  "id"                    TEXT PRIMARY KEY,
  "fromAddress"           TEXT NOT NULL UNIQUE,
  "matchType"             TEXT NOT NULL DEFAULT 'EXACT',
  "corpClientId"          TEXT NOT NULL,
  "defaultClassification" TEXT,
  "active"                BOOLEAN NOT NULL DEFAULT true,
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "EmailSenderMapping_fromAddress_idx" ON "EmailSenderMapping"("fromAddress");
CREATE INDEX IF NOT EXISTS "EmailSenderMapping_active_idx"      ON "EmailSenderMapping"("active");
