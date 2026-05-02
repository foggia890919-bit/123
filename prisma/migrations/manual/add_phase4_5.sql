-- Phase 4 + Phase 5: 분양·입주, 인구통계, 의료기관, 처방통계, 입지 점수.
-- Idempotent. Apply via Supabase SQL editor.

-- ── Phase 4 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ApartmentNotice" (
  "id" TEXT PRIMARY KEY,
  "externalId" TEXT NOT NULL UNIQUE,
  "source" TEXT NOT NULL,
  "noticeName" TEXT NOT NULL,
  "houseType" TEXT,
  "totalHouseholds" INTEGER,
  "generalHouseholds" INTEGER,
  "specialHouseholds" INTEGER,
  "region" TEXT,
  "cortarNo" TEXT,
  "address" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "noticeAt" TIMESTAMP(3),
  "applyStartAt" TIMESTAMP(3),
  "applyEndAt" TIMESTAMP(3),
  "contractAt" TIMESTAMP(3),
  "moveInAt" TIMESTAMP(3),
  "priceMin" INTEGER,
  "priceMax" INTEGER,
  "areaMin" DOUBLE PRECISION,
  "areaMax" DOUBLE PRECISION,
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ApartmentNotice_source_idx" ON "ApartmentNotice"("source");
CREATE INDEX IF NOT EXISTS "ApartmentNotice_cortarNo_idx" ON "ApartmentNotice"("cortarNo");
CREATE INDEX IF NOT EXISTS "ApartmentNotice_moveInAt_idx" ON "ApartmentNotice"("moveInAt");
CREATE INDEX IF NOT EXISTS "ApartmentNotice_latlng_idx" ON "ApartmentNotice"("latitude", "longitude");

CREATE TABLE IF NOT EXISTS "NoticeParcelMatch" (
  "id" TEXT PRIMARY KEY,
  "noticeId" TEXT NOT NULL REFERENCES "ApartmentNotice"("id") ON DELETE CASCADE,
  "parcelId" TEXT,
  "listingId" TEXT,
  "distanceM" DOUBLE PRECISION NOT NULL,
  "bearing" DOUBLE PRECISION,
  "matchType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "NoticeParcelMatch_noticeId_idx" ON "NoticeParcelMatch"("noticeId");
CREATE INDEX IF NOT EXISTS "NoticeParcelMatch_parcelId_idx" ON "NoticeParcelMatch"("parcelId");
CREATE INDEX IF NOT EXISTS "NoticeParcelMatch_listingId_idx" ON "NoticeParcelMatch"("listingId");
CREATE INDEX IF NOT EXISTS "NoticeParcelMatch_distanceM_idx" ON "NoticeParcelMatch"("distanceM");

CREATE TABLE IF NOT EXISTS "Census" (
  "id" TEXT PRIMARY KEY,
  "cortarNo" TEXT NOT NULL,
  "yearMonth" TEXT NOT NULL,
  "totalPop" INTEGER,
  "households" INTEGER,
  "age0_9" INTEGER,
  "age10_19" INTEGER,
  "age20_29" INTEGER,
  "age30_39" INTEGER,
  "age40_49" INTEGER,
  "age50_59" INTEGER,
  "age60_69" INTEGER,
  "age70Plus" INTEGER,
  "malePop" INTEGER,
  "femalePop" INTEGER,
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Census_cortarNo_yearMonth_key" UNIQUE ("cortarNo", "yearMonth")
);
CREATE INDEX IF NOT EXISTS "Census_cortarNo_idx" ON "Census"("cortarNo");
CREATE INDEX IF NOT EXISTS "Census_yearMonth_idx" ON "Census"("yearMonth");

-- ── Phase 5 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MedicalFacility" (
  "id" TEXT PRIMARY KEY,
  "ykiho" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "facilityType" TEXT,
  "specialties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "bedCount" INTEGER,
  "doctorCount" INTEGER,
  "equipment" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "address" TEXT,
  "cortarNo" TEXT,
  "sigungu" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "openedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "MedicalFacility_cortarNo_idx" ON "MedicalFacility"("cortarNo");
CREATE INDEX IF NOT EXISTS "MedicalFacility_sigungu_idx" ON "MedicalFacility"("sigungu");
CREATE INDEX IF NOT EXISTS "MedicalFacility_facilityType_idx" ON "MedicalFacility"("facilityType");
CREATE INDEX IF NOT EXISTS "MedicalFacility_status_idx" ON "MedicalFacility"("status");
CREATE INDEX IF NOT EXISTS "MedicalFacility_latlng_idx" ON "MedicalFacility"("latitude", "longitude");

CREATE TABLE IF NOT EXISTS "PrescriptionStat" (
  "id" TEXT PRIMARY KEY,
  "cortarNo" TEXT NOT NULL,
  "yearMonth" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "specialty" TEXT,
  "patientCount" INTEGER,
  "visitCount" INTEGER,
  "prescriptionCount" INTEGER,
  "totalAmount" INTEGER,
  "raw" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrescriptionStat_unique_key" UNIQUE ("cortarNo", "yearMonth", "scope", "specialty")
);
CREATE INDEX IF NOT EXISTS "PrescriptionStat_cortarNo_yearMonth_idx" ON "PrescriptionStat"("cortarNo", "yearMonth");
CREATE INDEX IF NOT EXISTS "PrescriptionStat_specialty_idx" ON "PrescriptionStat"("specialty");

CREATE TABLE IF NOT EXISTS "LocationScore" (
  "id" TEXT PRIMARY KEY,
  "parcelId" TEXT NOT NULL UNIQUE,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "backingHouseholds" INTEGER,
  "competitorClinics" INTEGER,
  "populationDensity" DOUBLE PRECISION,
  "prescriptionDemand" DOUBLE PRECISION,
  "supplyAdvantage" DOUBLE PRECISION,
  "buildableRoi" DOUBLE PRECISION,
  "trafficFlow" DOUBLE PRECISION,
  "pIndex" DOUBLE PRECISION,
  "prescriptionScore" DOUBLE PRECISION,
  "compositeScore" DOUBLE PRECISION,
  "recommendedSpecialties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
);
CREATE INDEX IF NOT EXISTS "LocationScore_compositeScore_idx" ON "LocationScore"("compositeScore");
