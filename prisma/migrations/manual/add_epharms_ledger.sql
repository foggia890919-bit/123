-- ePharms 매출원장 자동수집 (yk.ep45.co.kr)
-- 거래처별 ePharms 계정 + 일별 매출원장 + 동기화 로그
-- 적용: Supabase SQL Editor에서 1회 실행.

-- 1) 거래처별 ePharms 로그인 계정. PW는 AES-256-GCM 암호화 후 저장.
CREATE TABLE IF NOT EXISTS "EpharmsAccount" (
  "id"             TEXT NOT NULL,
  "bizNumber"      TEXT NOT NULL,
  "clientName"     TEXT NOT NULL,
  "loginId"        TEXT NOT NULL,
  "loginPwEnc"     TEXT NOT NULL,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "lastSyncedAt"   TIMESTAMP(3),
  "lastSyncStatus" TEXT,
  "lastSyncError"  TEXT,
  "memo"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EpharmsAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EpharmsAccount_bizNumber_key" UNIQUE ("bizNumber")
);
CREATE INDEX IF NOT EXISTS "EpharmsAccount_active_idx" ON "EpharmsAccount"("active");

-- 2) 매출원장 한 줄
CREATE TABLE IF NOT EXISTS "LedgerEntry" (
  "id"        TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "bizNumber" TEXT NOT NULL,
  "entryDate" TIMESTAMP(3) NOT NULL,
  "itemName"  TEXT NOT NULL,
  "sales"     DECIMAL(18,2) NOT NULL DEFAULT 0,
  "payment"   DECIMAL(18,2) NOT NULL DEFAULT 0,
  "balance"   DECIMAL(18,2) NOT NULL DEFAULT 0,
  "rowHash"   TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LedgerEntry_accountId_rowHash_key" UNIQUE ("accountId","rowHash"),
  CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "EpharmsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LedgerEntry_bizNumber_entryDate_idx" ON "LedgerEntry"("bizNumber","entryDate");
CREATE INDEX IF NOT EXISTS "LedgerEntry_accountId_entryDate_idx" ON "LedgerEntry"("accountId","entryDate");

-- 3) 동기화 시도 기록
CREATE TABLE IF NOT EXISTS "LedgerSyncLog" (
  "id"           TEXT NOT NULL,
  "accountId"    TEXT NOT NULL,
  "startedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"   TIMESTAMP(3),
  "status"       TEXT NOT NULL,
  "rowsFetched"  INTEGER NOT NULL DEFAULT 0,
  "rowsInserted" INTEGER NOT NULL DEFAULT 0,
  "errorMsg"     TEXT,
  CONSTRAINT "LedgerSyncLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LedgerSyncLog_accountId_fkey" FOREIGN KEY ("accountId")
    REFERENCES "EpharmsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LedgerSyncLog_accountId_startedAt_idx" ON "LedgerSyncLog"("accountId","startedAt");
CREATE INDEX IF NOT EXISTS "LedgerSyncLog_status_idx" ON "LedgerSyncLog"("status");
