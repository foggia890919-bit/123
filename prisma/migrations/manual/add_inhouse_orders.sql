-- 원내거래 주문 테이블 (장바구니 → 카톡 알람 → ePharms 주문)
-- Supabase SQL Editor에서 실행

CREATE TYPE IF NOT EXISTS "InhouseOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ORDERED', 'REJECTED');

CREATE TABLE IF NOT EXISTS "InhouseOrder" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "clientName"  TEXT NOT NULL,
  "bizNumber"   TEXT,
  "status"      "InhouseOrderStatus" NOT NULL DEFAULT 'PENDING',
  "note"        TEXT,
  "confirmedAt" TIMESTAMP(3),
  "orderedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InhouseOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InhouseOrder_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "InhouseOrder_userId_idx"    ON "InhouseOrder"("userId");
CREATE INDEX IF NOT EXISTS "InhouseOrder_status_idx"    ON "InhouseOrder"("status");
CREATE INDEX IF NOT EXISTS "InhouseOrder_createdAt_idx" ON "InhouseOrder"("createdAt");

CREATE TABLE IF NOT EXISTS "InhouseOrderItem" (
  "id"           TEXT NOT NULL,
  "orderId"      TEXT NOT NULL,
  "priceCode"    TEXT NOT NULL,
  "productName"  TEXT NOT NULL,
  "manufacturer" TEXT NOT NULL DEFAULT '',
  "spec"         TEXT,
  "basePrice"    DECIMAL(18,2),
  "unitPrice"    DECIMAL(18,2),
  "quantity"     INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "InhouseOrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InhouseOrderItem_orderId_fkey" FOREIGN KEY ("orderId")
    REFERENCES "InhouseOrder"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "InhouseOrderItem_orderId_idx" ON "InhouseOrderItem"("orderId");
