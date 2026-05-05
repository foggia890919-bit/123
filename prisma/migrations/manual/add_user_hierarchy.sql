-- Phase 1B: User permission hierarchy
-- Adds self-referencing parentUserId to User so we can express
-- 영업사원 → 본인법인 → 상위법인 trees and gate report visibility
-- to (self + all descendants).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "parentUserId" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_parentUserId_fkey"
  FOREIGN KEY ("parentUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "User_parentUserId_idx" ON "User"("parentUserId");
