-- 실시간 재고 조회 대기줄 (job queue)
-- Vercel(KMD API)이 PENDING row 를 만들면, 사무실 PC 워커가 폴링으로 집어
-- 크롤 후 InventorySnapshot 저장 + status 를 DONE/ERROR 로 갱신한다.
-- Vercel→PC 인바운드가 불가능하므로 DB(Supabase)를 매개로 한다.
--
-- 실행: Supabase SQL 에디터에 그대로 붙여넣어 1회 실행 (마이그레이션 미사용 환경).

CREATE TABLE IF NOT EXISTS "RefreshRequest" (
  "id" TEXT PRIMARY KEY,
  "codes" TEXT[] NOT NULL,
  "sites" TEXT[],
  "status" TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | RUNNING | DONE | ERROR | EXPIRED
  "error" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "doneAt" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "RefreshRequest_status_idx" ON "RefreshRequest"("status", "createdAt");
