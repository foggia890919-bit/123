CREATE TABLE IF NOT EXISTS "SearchHistory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "companies" TEXT[] NOT NULL DEFAULT '{}',
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SearchHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SearchHistory_userId_searchedAt_idx" ON "SearchHistory"("userId", "searchedAt");

ALTER TABLE "SearchHistory" ADD CONSTRAINT "SearchHistory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
