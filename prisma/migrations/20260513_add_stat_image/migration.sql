CREATE TABLE IF NOT EXISTS "StatImage" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "userId"       TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "clientId"     TEXT REFERENCES "UserClient"("id") ON DELETE SET NULL,
  "year"         INTEGER NOT NULL,
  "month"        INTEGER NOT NULL,
  "driveFileId"  TEXT NOT NULL,
  "driveViewUrl" TEXT,
  "fileName"     TEXT NOT NULL,
  "storedName"   TEXT NOT NULL,
  "mimeType"     TEXT,
  "batchKey"     TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "StatImage_userId_idx" ON "StatImage"("userId");
CREATE INDEX IF NOT EXISTS "StatImage_clientId_idx" ON "StatImage"("clientId");
CREATE INDEX IF NOT EXISTS "StatImage_batchKey_idx" ON "StatImage"("batchKey");
CREATE INDEX IF NOT EXISTS "StatImage_year_month_idx" ON "StatImage"("year", "month");
