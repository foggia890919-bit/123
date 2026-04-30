CREATE TABLE IF NOT EXISTS "BizDigestQueue" (
  "id" TEXT PRIMARY KEY,
  "type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "decisionOptions" JSONB,
  "resolvedAt" TIMESTAMPTZ,
  "resolvedBy" TEXT,
  "resolvedAnswer" TEXT,
  "sentAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "BizDigestQueue_sentAt_idx" ON "BizDigestQueue"("sentAt");
CREATE INDEX IF NOT EXISTS "BizDigestQueue_type_idx" ON "BizDigestQueue"("type");

CREATE TABLE IF NOT EXISTS "TelegramReply" (
  "id" TEXT PRIMARY KEY,
  "messageId" TEXT NOT NULL UNIQUE,
  "chatId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "digestQueueId" TEXT,
  "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "TelegramReply_digestQueueId_fkey"
    FOREIGN KEY ("digestQueueId") REFERENCES "BizDigestQueue"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "TelegramReply_digestQueueId_idx" ON "TelegramReply"("digestQueueId");
