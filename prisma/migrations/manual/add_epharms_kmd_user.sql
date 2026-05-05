-- ePharms 매출원장 자동수집: KMD 사용자 직접 매핑 추가
-- 기존 매칭 흐름: EpharmsAccount.bizNumber ↔ UserClient.bizNumber (매핑된 거래처 사용자만 마이페이지 노출)
-- 추가 매칭 흐름: EpharmsAccount.kmdUserId ↔ User.id (약국/거래처 사용자가 본인 KMD 계정으로 직접 노출)
-- 적용: Supabase SQL Editor에서 1회 실행.

ALTER TABLE "EpharmsAccount"
  ADD COLUMN IF NOT EXISTS "kmdUserId" TEXT;

-- User 삭제 시 EpharmsAccount는 살리고 매핑만 끊기 (SET NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'EpharmsAccount'
       AND constraint_name = 'EpharmsAccount_kmdUserId_fkey'
  ) THEN
    ALTER TABLE "EpharmsAccount"
      ADD CONSTRAINT "EpharmsAccount_kmdUserId_fkey"
      FOREIGN KEY ("kmdUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "EpharmsAccount_kmdUserId_idx"
  ON "EpharmsAccount"("kmdUserId");
