-- Real estate scraper / alerts / MOLIT cache
-- Idempotent: safe to re-run. Apply via Supabase SQL editor.

CREATE TABLE IF NOT EXISTS "REAgent" (
  "id" TEXT PRIMARY KEY,
  "externalId" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "address" TEXT,
  "representative" TEXT,
  "registrationNo" TEXT,
  "source" TEXT NOT NULL DEFAULT 'naver',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "REAgent_name_idx" ON "REAgent"("name");
CREATE INDEX IF NOT EXISTS "REAgent_phone_idx" ON "REAgent"("phone");

CREATE TABLE IF NOT EXISTS "REListing" (
  "id" TEXT PRIMARY KEY,
  "externalId" TEXT NOT NULL UNIQUE,
  "source" TEXT NOT NULL DEFAULT 'naver',
  "url" TEXT,
  "tradeType" TEXT NOT NULL,
  "propertyType" TEXT NOT NULL,
  "title" TEXT,
  "cortarNo" TEXT,
  "address" TEXT,
  "region" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "priceSale" INTEGER,
  "priceDeposit" INTEGER,
  "priceMonthly" INTEGER,
  "areaSupply" DOUBLE PRECISION,
  "areaExclusive" DOUBLE PRECISION,
  "floor" TEXT,
  "description" TEXT,
  "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "raw" JSONB,
  "agentId" TEXT REFERENCES "REAgent"("id") ON DELETE SET NULL,
  "postedAt" TIMESTAMP(3),
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "REListing_cortarNo_idx" ON "REListing"("cortarNo");
CREATE INDEX IF NOT EXISTS "REListing_propertyType_idx" ON "REListing"("propertyType");
CREATE INDEX IF NOT EXISTS "REListing_tradeType_idx" ON "REListing"("tradeType");
CREATE INDEX IF NOT EXISTS "REListing_firstSeenAt_idx" ON "REListing"("firstSeenAt");
CREATE INDEX IF NOT EXISTS "REListing_priceSale_idx" ON "REListing"("priceSale");
CREATE INDEX IF NOT EXISTS "REListing_priceDeposit_idx" ON "REListing"("priceDeposit");

CREATE TABLE IF NOT EXISTS "REWatch" (
  "id" TEXT PRIMARY KEY,
  "ownerEmail" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "cortarNos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "propertyTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tradeTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "priceSaleMax" INTEGER,
  "priceDepositMax" INTEGER,
  "priceMonthlyMax" INTEGER,
  "areaMinM2" DOUBLE PRECISION,
  "areaMaxM2" DOUBLE PRECISION,
  "floorMin" INTEGER,
  "floorMax" INTEGER,
  "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "excludeKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notifySms" BOOLEAN NOT NULL DEFAULT FALSE,
  "notifyTelegram" BOOLEAN NOT NULL DEFAULT FALSE,
  "smsTo" TEXT,
  "telegramChatId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "REWatch_ownerEmail_idx" ON "REWatch"("ownerEmail");
CREATE INDEX IF NOT EXISTS "REWatch_enabled_idx" ON "REWatch"("enabled");

CREATE TABLE IF NOT EXISTS "REAlert" (
  "id" TEXT PRIMARY KEY,
  "watchId" TEXT NOT NULL REFERENCES "REWatch"("id") ON DELETE CASCADE,
  "listingId" TEXT NOT NULL REFERENCES "REListing"("id") ON DELETE CASCADE,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "REAlert_watchId_listingId_key" UNIQUE ("watchId", "listingId")
);
CREATE INDEX IF NOT EXISTS "REAlert_status_idx" ON "REAlert"("status");
CREATE INDEX IF NOT EXISTS "REAlert_createdAt_idx" ON "REAlert"("createdAt");

CREATE TABLE IF NOT EXISTS "MolitTrade" (
  "id" TEXT PRIMARY KEY,
  "dealKind" TEXT NOT NULL,
  "tradeType" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "lawdCd" TEXT NOT NULL,
  "dealYearMonth" TEXT NOT NULL,
  "dealDay" INTEGER,
  "buildingName" TEXT,
  "areaM2" DOUBLE PRECISION,
  "floor" TEXT,
  "buildYear" INTEGER,
  "amount" INTEGER,
  "deposit" INTEGER,
  "monthlyRent" INTEGER,
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "MolitTrade_lawdCd_dealYearMonth_idx" ON "MolitTrade"("lawdCd", "dealYearMonth");
CREATE INDEX IF NOT EXISTS "MolitTrade_dealKind_idx" ON "MolitTrade"("dealKind");
