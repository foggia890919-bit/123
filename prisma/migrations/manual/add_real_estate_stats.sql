-- R-ONE 임대동향조사 + 소상공인 상권정보 캐시 테이블.
-- Idempotent. Apply via Supabase SQL editor.

CREATE TABLE IF NOT EXISTS "RoneStat" (
  "id" TEXT PRIMARY KEY,
  "buildingType" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "regionCode" TEXT,
  "yearQuarter" TEXT NOT NULL,
  "rentPerM2" DOUBLE PRECISION,
  "vacancyRate" DOUBLE PRECISION,
  "yieldRate" DOUBLE PRECISION,
  "capRate" DOUBLE PRECISION,
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoneStat_buildingType_region_yearQuarter_key" UNIQUE ("buildingType", "region", "yearQuarter")
);
CREATE INDEX IF NOT EXISTS "RoneStat_region_idx" ON "RoneStat"("region");
CREATE INDEX IF NOT EXISTS "RoneStat_yearQuarter_idx" ON "RoneStat"("yearQuarter");

CREATE TABLE IF NOT EXISTS "SbizMarketArea" (
  "id" TEXT PRIMARY KEY,
  "trarNo" TEXT NOT NULL UNIQUE,
  "trarName" TEXT NOT NULL,
  "cortarNo" TEXT,
  "sido" TEXT,
  "sigungu" TEXT,
  "storeCount" INTEGER,
  "medicalClinic" INTEGER,
  "populationDay" INTEGER,
  "populationNight" INTEGER,
  "estimatedRentPerM2" DOUBLE PRECISION,
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SbizMarketArea_cortarNo_idx" ON "SbizMarketArea"("cortarNo");
CREATE INDEX IF NOT EXISTS "SbizMarketArea_sigungu_idx" ON "SbizMarketArea"("sigungu");
