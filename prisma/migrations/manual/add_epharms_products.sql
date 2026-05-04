-- 자동주문 시스템 1단계: 상품 마스터 + 거래처별 단가
-- Supabase SQL Editor에서 1회 실행

-- 1) EpharmsAccount에 isMaster 플래그 추가
ALTER TABLE "EpharmsAccount" ADD COLUMN IF NOT EXISTS "isMaster" BOOLEAN NOT NULL DEFAULT false;

-- 2) 이팜스 상품 마스터
CREATE TABLE IF NOT EXISTS "EpharmsProduct" (
  "id"           TEXT NOT NULL,
  "priceCode"    TEXT NOT NULL,
  "productName"  TEXT NOT NULL,
  "manufacturer" TEXT NOT NULL,
  "spec"         TEXT,
  "productGroup" TEXT,
  "ingredient"   TEXT,
  "basePrice"    DECIMAL(18,2) NOT NULL DEFAULT 0,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "fetchedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EpharmsProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EpharmsProduct_priceCode_key" UNIQUE ("priceCode")
);
CREATE INDEX IF NOT EXISTS "EpharmsProduct_productName_idx"  ON "EpharmsProduct"("productName");
CREATE INDEX IF NOT EXISTS "EpharmsProduct_manufacturer_idx" ON "EpharmsProduct"("manufacturer");
CREATE INDEX IF NOT EXISTS "EpharmsProduct_ingredient_idx"   ON "EpharmsProduct"("ingredient");
CREATE INDEX IF NOT EXISTS "EpharmsProduct_active_idx"       ON "EpharmsProduct"("active");

-- 3) 거래처별 상품 단가 (L2 캐시)
CREATE TABLE IF NOT EXISTS "ClientProductPrice" (
  "id"          TEXT NOT NULL,
  "bizNumber"   TEXT NOT NULL,
  "priceCode"   TEXT NOT NULL,
  "unitPrice"   DECIMAL(18,2) NOT NULL,
  "source"      TEXT NOT NULL,
  "setByUserId" TEXT,
  "setAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientProductPrice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClientProductPrice_bizNumber_priceCode_key" UNIQUE ("bizNumber","priceCode"),
  CONSTRAINT "ClientProductPrice_priceCode_fkey" FOREIGN KEY ("priceCode")
    REFERENCES "EpharmsProduct"("priceCode") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ClientProductPrice_priceCode_idx" ON "ClientProductPrice"("priceCode");
CREATE INDEX IF NOT EXISTS "ClientProductPrice_bizNumber_idx" ON "ClientProductPrice"("bizNumber");

-- 4) 상품 동기화 로그
CREATE TABLE IF NOT EXISTS "ProductSyncLog" (
  "id"           TEXT NOT NULL,
  "triggeredBy"  TEXT,
  "startedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"   TIMESTAMP(3),
  "status"       TEXT NOT NULL,
  "source"       TEXT NOT NULL,
  "rowsTotal"    INTEGER NOT NULL DEFAULT 0,
  "rowsInserted" INTEGER NOT NULL DEFAULT 0,
  "rowsUpdated"  INTEGER NOT NULL DEFAULT 0,
  "errorMsg"     TEXT,
  CONSTRAINT "ProductSyncLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProductSyncLog_startedAt_idx" ON "ProductSyncLog"("startedAt");
CREATE INDEX IF NOT EXISTS "ProductSyncLog_status_idx"    ON "ProductSyncLog"("status");
