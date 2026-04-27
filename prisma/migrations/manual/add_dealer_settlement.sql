-- DealerType enum
CREATE TYPE "DealerType" AS ENUM ('CORPORATION', 'INDIVIDUAL', 'UPPER_CORP', 'LOWER_CORP', 'SELF');

-- dealerType column on UserClient
ALTER TABLE "UserClient" ADD COLUMN IF NOT EXISTS "dealerType" "DealerType";

-- SettlementTemplate
CREATE TABLE IF NOT EXISTS "SettlementTemplate" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "corpName"  TEXT NOT NULL,
  "fileKey"   TEXT NOT NULL,
  "fileName"  TEXT NOT NULL,
  "columnMap" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SettlementTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SettlementTemplate_userId_corpName_key" ON "SettlementTemplate"("userId", "corpName");
CREATE INDEX IF NOT EXISTS "SettlementTemplate_userId_idx" ON "SettlementTemplate"("userId");

ALTER TABLE "SettlementTemplate" DROP CONSTRAINT IF EXISTS "SettlementTemplate_userId_fkey";
ALTER TABLE "SettlementTemplate" ADD CONSTRAINT "SettlementTemplate_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SettlementDocument
CREATE TABLE IF NOT EXISTS "SettlementDocument" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "templateId" TEXT,
  "corpName"   TEXT NOT NULL,
  "fileKey"    TEXT NOT NULL,
  "fileName"   TEXT NOT NULL,
  "period"     TEXT NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'PENDING',
  "parsedData" JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SettlementDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SettlementDocument_userId_idx" ON "SettlementDocument"("userId");
CREATE INDEX IF NOT EXISTS "SettlementDocument_templateId_idx" ON "SettlementDocument"("templateId");
CREATE INDEX IF NOT EXISTS "SettlementDocument_userId_period_idx" ON "SettlementDocument"("userId", "period");

ALTER TABLE "SettlementDocument" DROP CONSTRAINT IF EXISTS "SettlementDocument_userId_fkey";
ALTER TABLE "SettlementDocument" ADD CONSTRAINT "SettlementDocument_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SettlementDocument" DROP CONSTRAINT IF EXISTS "SettlementDocument_templateId_fkey";
ALTER TABLE "SettlementDocument" ADD CONSTRAINT "SettlementDocument_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "SettlementTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
