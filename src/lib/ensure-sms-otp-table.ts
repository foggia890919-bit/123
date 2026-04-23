import { prisma } from "./prisma";

let ensurePromise: Promise<void> | null = null;

export function ensureSmsOtpTable(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SmsOtp" (
        "id"        TEXT PRIMARY KEY,
        "phone"     TEXT NOT NULL,
        "code"      TEXT NOT NULL,
        "verified"  BOOLEAN NOT NULL DEFAULT false,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "SmsOtp_phone_idx" ON "SmsOtp"("phone")`
    );
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}
