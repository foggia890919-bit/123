-- Phase 6 (교통/약국/일일 보고서). Idempotent.

CREATE TABLE IF NOT EXISTS "SubwayStation" (
  "id" TEXT PRIMARY KEY,
  "externalId" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "lineNumber" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "cortarNo" TEXT,
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SubwayStation_name_idx" ON "SubwayStation"("name");
CREATE INDEX IF NOT EXISTS "SubwayStation_latlng_idx" ON "SubwayStation"("latitude", "longitude");

CREATE TABLE IF NOT EXISTS "SubwayRidership" (
  "id" TEXT PRIMARY KEY,
  "stationId" TEXT NOT NULL REFERENCES "SubwayStation"("id") ON DELETE CASCADE,
  "yearMonth" TEXT NOT NULL,
  "rideCount" INTEGER NOT NULL,
  "alightCount" INTEGER NOT NULL,
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubwayRidership_stationId_yearMonth_key" UNIQUE ("stationId", "yearMonth")
);
CREATE INDEX IF NOT EXISTS "SubwayRidership_yearMonth_idx" ON "SubwayRidership"("yearMonth");

CREATE TABLE IF NOT EXISTS "OwnedPharmacy" (
  "id" TEXT PRIMARY KEY,
  "externalId" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "bizNumber" TEXT,
  "address" TEXT,
  "cortarNo" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "joinedAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "notes" TEXT,
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OwnedPharmacy_cortarNo_idx" ON "OwnedPharmacy"("cortarNo");
CREATE INDEX IF NOT EXISTS "OwnedPharmacy_latlng_idx" ON "OwnedPharmacy"("latitude", "longitude");

CREATE TABLE IF NOT EXISTS "PharmacySupply" (
  "id" TEXT PRIMARY KEY,
  "pharmacyId" TEXT NOT NULL REFERENCES "OwnedPharmacy"("id") ON DELETE CASCADE,
  "yearMonth" TEXT NOT NULL,
  "totalAmount" INTEGER NOT NULL,
  "scriptCount" INTEGER,
  "raw" JSONB,
  CONSTRAINT "PharmacySupply_pharmacyId_yearMonth_key" UNIQUE ("pharmacyId", "yearMonth")
);
CREATE INDEX IF NOT EXISTS "PharmacySupply_yearMonth_idx" ON "PharmacySupply"("yearMonth");

CREATE TABLE IF NOT EXISTS "DailyReport" (
  "id" TEXT PRIMARY KEY,
  "reportDate" TIMESTAMP(3) NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'global',
  "topPicks" JSONB NOT NULL,
  "newListings" JSONB NOT NULL,
  "newNotices" JSONB NOT NULL,
  "summaryText" TEXT,
  "channel" TEXT NOT NULL DEFAULT 'log',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "recipient" TEXT,
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyReport_reportDate_scope_key" UNIQUE ("reportDate", "scope")
);
CREATE INDEX IF NOT EXISTS "DailyReport_status_idx" ON "DailyReport"("status");
CREATE INDEX IF NOT EXISTS "DailyReport_createdAt_idx" ON "DailyReport"("createdAt");
