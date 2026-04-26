-- ============================================================================
-- BOARD MIGRATION — run in Supabase SQL editor after _MASTER_MIGRATION.sql
-- Safe to re-run: all statements use IF NOT EXISTS guards.
-- ============================================================================

-- 1. Notice popup columns
ALTER TABLE "Notice" ADD COLUMN IF NOT EXISTS "showAsPopup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Notice" ADD COLUMN IF NOT EXISTS "popupUntil"  TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Notice_showAsPopup_idx" ON "Notice"("showAsPopup", "popupUntil");

-- 2. HomeBanner
CREATE TABLE IF NOT EXISTS "HomeBanner" (
  "id"          TEXT PRIMARY KEY,
  "title"       TEXT NOT NULL,
  "subtitle"    TEXT,
  "description" TEXT,
  "buttonText"  TEXT,
  "buttonLink"  TEXT,
  "imageKey"    TEXT,
  "bgColor"     TEXT,
  "order"       INTEGER NOT NULL DEFAULT 0,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "HomeBanner_active_order_idx" ON "HomeBanner"("active", "order");

-- 3. Board type enum
DO $$ BEGIN
  CREATE TYPE "BoardType" AS ENUM ('TEXT', 'IMAGE', 'MIXED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 4. Board
CREATE TABLE IF NOT EXISTS "Board" (
  "id"          TEXT PRIMARY KEY,
  "slug"        TEXT NOT NULL UNIQUE,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "type"        "BoardType" NOT NULL DEFAULT 'MIXED',
  "order"       INTEGER NOT NULL DEFAULT 0,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Board_active_order_idx" ON "Board"("active", "order");

-- 5. Post
CREATE TABLE IF NOT EXISTS "Post" (
  "id"        TEXT PRIMARY KEY,
  "boardId"   TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "content"   TEXT,
  "images"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "views"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Post_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Post_userId_fkey"  FOREIGN KEY ("userId")  REFERENCES "User"("id")  ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Post_boardId_createdAt_idx" ON "Post"("boardId", "createdAt");
CREATE INDEX IF NOT EXISTS "Post_userId_idx"            ON "Post"("userId");

-- 6. BoardEditor (per-board editor assignment)
CREATE TABLE IF NOT EXISTS "BoardEditor" (
  "id"      TEXT PRIMARY KEY,
  "boardId" TEXT NOT NULL,
  "userId"  TEXT NOT NULL,
  CONSTRAINT "BoardEditor_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BoardEditor_userId_fkey"  FOREIGN KEY ("userId")  REFERENCES "User"("id")  ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "BoardEditor_boardId_userId_key" ON "BoardEditor"("boardId", "userId");
CREATE INDEX IF NOT EXISTS "BoardEditor_userId_idx" ON "BoardEditor"("userId");

-- 7. Sample boards
INSERT INTO "Board" ("id", "slug", "name", "description", "type", "order", "active", "createdAt", "updatedAt")
VALUES
  ('board_realestate', 'realestate',  '개원입지부동산', '개원 및 입지 관련 부동산 정보를 공유합니다.',  'MIXED', 0, true, NOW(), NOW()),
  ('board_news',       'news',        '업계뉴스',       '의약 업계 최신 뉴스와 정보를 공유합니다.',       'TEXT',  1, true, NOW(), NOW()),
  ('board_free',       'free',        '자유게시판',     '회원 간 자유롭게 소통하는 공간입니다.',           'MIXED', 2, true, NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;
