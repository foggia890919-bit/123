CREATE TABLE IF NOT EXISTS "CorpRateFile" (
  "id"            TEXT PRIMARY KEY,
  "corpClientId"  TEXT NOT NULL,
  "companyName"   TEXT NOT NULL,
  "applyMonth"    TEXT NOT NULL,
  "fileName"      TEXT NOT NULL,
  "fileKey"       TEXT NOT NULL,
  "uploadedById"  TEXT NOT NULL,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "CorpRateFile_corp_company_month_unique" UNIQUE ("corpClientId","companyName","applyMonth"),
  CONSTRAINT "CorpRateFile_corpClientId_fkey" FOREIGN KEY ("corpClientId") REFERENCES "UserClient"("id") ON DELETE CASCADE,
  CONSTRAINT "CorpRateFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "CorpRateFile_corpClientId_idx" ON "CorpRateFile"("corpClientId");
CREATE INDEX IF NOT EXISTS "CorpRateFile_applyMonth_idx" ON "CorpRateFile"("applyMonth");

CREATE TABLE IF NOT EXISTS "CorpRateFileHistory" (
  "id"            TEXT PRIMARY KEY,
  "rateFileId"    TEXT NOT NULL,
  "corpClientId"  TEXT NOT NULL,
  "companyName"   TEXT NOT NULL,
  "applyMonth"    TEXT NOT NULL,
  "action"        TEXT NOT NULL,
  "prevFileKey"   TEXT,
  "prevFileName"  TEXT,
  "newFileKey"    TEXT,
  "newFileName"   TEXT,
  "performedById" TEXT NOT NULL,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "CorpRateFileHistory_rateFileId_fkey" FOREIGN KEY ("rateFileId") REFERENCES "CorpRateFile"("id") ON DELETE CASCADE,
  CONSTRAINT "CorpRateFileHistory_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "CorpRateFileHistory_rateFileId_idx" ON "CorpRateFileHistory"("rateFileId");
CREATE INDEX IF NOT EXISTS "CorpRateFileHistory_createdAt_idx" ON "CorpRateFileHistory"("createdAt" DESC);
