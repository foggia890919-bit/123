import { prisma } from "./prisma";

// 식약처 "의약품 묶음정보"(동일제조소 생산 제네릭) 적재 테이블.
// 응답 필드명이 미검증 상태라 raw(JSONB)에 원본 행을 통째로 보관하고,
// 매핑 컬럼(manufacturerName 등)이 빗나가면 raw에서 백필할 수 있게 한다.
// generation: 전량 교체 동기화의 세대 태그 — 조회는 SystemSetting.bundleCurrentGen 세대만 읽는다.
let ensurePromise: Promise<void> | null = null;

export function ensureBundleTable(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MfdsBundleItem" (
        "id"               TEXT PRIMARY KEY,
        "groupKey"         TEXT NOT NULL,
        "manufacturerName" TEXT,
        "itemName"         TEXT,
        "entpName"         TEXT,
        "ingredientName"   TEXT,
        "itemSeq"          TEXT,
        "productKey"       TEXT,
        "raw"              JSONB NOT NULL,
        "generation"       TEXT NOT NULL,
        "syncedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MfdsBundleItem_groupKey_idx" ON "MfdsBundleItem"("groupKey")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MfdsBundleItem_productKey_idx" ON "MfdsBundleItem"("productKey")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MfdsBundleItem_itemSeq_idx" ON "MfdsBundleItem"("itemSeq")`);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}
