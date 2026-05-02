-- Phase 3: 토지·건축 캐시 테이블.
-- Idempotent. Apply via Supabase SQL editor.

CREATE TABLE IF NOT EXISTS "Parcel" (
  "id" TEXT PRIMARY KEY,
  "pnu" TEXT NOT NULL UNIQUE,
  "jibun" TEXT,
  "cortarNo" TEXT,
  "sigungu" TEXT,
  "area" DOUBLE PRECISION,
  "landUse" TEXT,
  "landUseDistrict" TEXT,
  "landUseExtra" TEXT,
  "bcrLimit" DOUBLE PRECISION,
  "farLimit" DOUBLE PRECISION,
  "officialPrice" INTEGER,
  "centerLat" DOUBLE PRECISION,
  "centerLng" DOUBLE PRECISION,
  "geometry" JSONB,
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Parcel_cortarNo_idx" ON "Parcel"("cortarNo");
CREATE INDEX IF NOT EXISTS "Parcel_sigungu_idx" ON "Parcel"("sigungu");
CREATE INDEX IF NOT EXISTS "Parcel_landUse_idx" ON "Parcel"("landUse");

CREATE TABLE IF NOT EXISTS "BuildingLedger" (
  "id" TEXT PRIMARY KEY,
  "pnu" TEXT NOT NULL,
  "parcelId" TEXT REFERENCES "Parcel"("id") ON DELETE SET NULL,
  "bldgNm" TEXT,
  "totalFloorArea" DOUBLE PRECISION,
  "buildArea" DOUBLE PRECISION,
  "bcr" DOUBLE PRECISION,
  "far" DOUBLE PRECISION,
  "groundFloors" INTEGER,
  "undergroundFloors" INTEGER,
  "mainPurpose" TEXT,
  "structure" TEXT,
  "approvedAt" TIMESTAMP(3),
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "BuildingLedger_pnu_idx" ON "BuildingLedger"("pnu");
CREATE INDEX IF NOT EXISTS "BuildingLedger_parcelId_idx" ON "BuildingLedger"("parcelId");

CREATE TABLE IF NOT EXISTS "MassingResult" (
  "id" TEXT PRIMARY KEY,
  "parcelId" TEXT NOT NULL REFERENCES "Parcel"("id") ON DELETE CASCADE,
  "scenario" TEXT NOT NULL,
  "buildingType" TEXT NOT NULL,
  "floorHeight" DOUBLE PRECISION NOT NULL,
  "efficiency" DOUBLE PRECISION NOT NULL,
  "parkingRule" TEXT NOT NULL,
  "bcrApplied" DOUBLE PRECISION NOT NULL,
  "farApplied" DOUBLE PRECISION NOT NULL,
  "maxBuildArea" DOUBLE PRECISION NOT NULL,
  "maxFloorArea" DOUBLE PRECISION NOT NULL,
  "maxFloors" INTEGER NOT NULL,
  "parkingRequired" INTEGER NOT NULL,
  "basementFloors" INTEGER NOT NULL,
  "netRentableArea" DOUBLE PRECISION NOT NULL,
  "estimatedConstructionCost" INTEGER NOT NULL,
  "notes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "estimatedAnnualRent" INTEGER,
  "estimatedRoi" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "MassingResult_parcelId_idx" ON "MassingResult"("parcelId");
CREATE INDEX IF NOT EXISTS "MassingResult_scenario_idx" ON "MassingResult"("scenario");
