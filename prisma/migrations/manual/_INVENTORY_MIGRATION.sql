-- ============================================================================
-- INVENTORY MIGRATION — run ONCE in the Supabase SQL editor.
-- Creates WholesaleSite, InventorySnapshot, ScrapeJob tables for the
-- pre-scraped inventory cache (worker writes, web reads).
-- Safe to re-run: all statements use IF NOT EXISTS guards.
-- ============================================================================

-- 1. WholesaleSite
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

-- 2. InventorySnapshot (worker writes one row per code per site per scrape)
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
CREATE INDEX IF NOT EXISTS "InventorySnapshot_insuranceCode_idx"
  ON "InventorySnapshot"("insuranceCode");
CREATE INDEX IF NOT EXISTS "InventorySnapshot_siteKey_insuranceCode_idx"
  ON "InventorySnapshot"("siteKey", "insuranceCode");
CREATE INDEX IF NOT EXISTS "InventorySnapshot_scrapedAt_idx"
  ON "InventorySnapshot"("scrapedAt");

-- 3. ScrapeJob (batch progress tracking)
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

-- 4. Seed wholesale sites (3 active: ibjp, inchun, family)
INSERT INTO "WholesaleSite" ("key", "name", "baseUrl", "loginUrl", "active", "createdAt", "updatedAt")
VALUES
  ('ibjp',   '이비젠팜',   'https://ibjp.co.kr',           'https://ibjp.co.kr/login',                                         true, NOW(), NOW()),
  ('inchun', '인천약품',   'https://inchunpharm.com',      'https://inchunpharm.com/Homepage/contents/login/login.asp',        true, NOW(), NOW()),
  ('family', '훼밀리팜',   'http://family-pharm.co.kr',    'http://family-pharm.co.kr/member/',                                true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- Verify:
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('WholesaleSite', 'InventorySnapshot', 'ScrapeJob');
-- SELECT * FROM "WholesaleSite";
