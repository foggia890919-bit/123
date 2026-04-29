-- FilterMapping 테이블
CREATE TABLE IF NOT EXISTS "FilterMapping" (
  "id"               TEXT NOT NULL,
  "clientName"       TEXT NOT NULL,
  "companyName"      TEXT NOT NULL,
  "submissionEntity" TEXT NOT NULL,
  "managerName"      TEXT,
  "managerPhone"     TEXT,
  "notes"            TEXT,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FilterMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FilterMapping_clientName_companyName_key"
  ON "FilterMapping"("clientName", "companyName");
CREATE INDEX IF NOT EXISTS "FilterMapping_clientName_idx" ON "FilterMapping"("clientName");
CREATE INDEX IF NOT EXISTS "FilterMapping_companyName_idx" ON "FilterMapping"("companyName");

-- FilterRequest 컬럼 추가
ALTER TABLE "FilterRequest"
  ADD COLUMN IF NOT EXISTS "requestType"     TEXT NOT NULL DEFAULT '신규',
  ADD COLUMN IF NOT EXISTS "mappingId"       TEXT,
  ADD COLUMN IF NOT EXISTS "responseToken"   TEXT,
  ADD COLUMN IF NOT EXISTS "respondedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "respondedResult" TEXT,
  ADD COLUMN IF NOT EXISTS "alimtalkSentAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "salesNotifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "FilterRequest_responseToken_key"
  ON "FilterRequest"("responseToken") WHERE "responseToken" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "FilterRequest_status_idx" ON "FilterRequest"("status");

ALTER TABLE "FilterRequest"
  DROP CONSTRAINT IF EXISTS "FilterRequest_mappingId_fkey";
ALTER TABLE "FilterRequest"
  ADD CONSTRAINT "FilterRequest_mappingId_fkey"
  FOREIGN KEY ("mappingId") REFERENCES "FilterMapping"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
