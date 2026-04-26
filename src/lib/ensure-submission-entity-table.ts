import { prisma } from "./prisma";

let ensurePromise: Promise<void> | null = null;

export function ensureSubmissionEntityTable(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SubmissionEntity" (
        "name" TEXT PRIMARY KEY,
        "contactName" TEXT,
        "email" TEXT,
        "phone" TEXT,
        "fax" TEXT,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}
