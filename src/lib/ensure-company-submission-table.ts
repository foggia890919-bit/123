import { prisma } from "./prisma";

let ensurePromise: Promise<void> | null = null;

export function ensureCompanySubmissionTable(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CompanySubmission" (
        "companyName" TEXT PRIMARY KEY,
        "submissionEntity" TEXT,
        "contactName" TEXT,
        "email" TEXT,
        "phone" TEXT,
        "fax" TEXT,
        "defaultAdditionalRate" DOUBLE PRECISION,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // 기존 환경(구 스키마)을 위한 컬럼 추가
    await prisma.$executeRawUnsafe(`ALTER TABLE "CompanySubmission" ADD COLUMN IF NOT EXISTS "submissionEntity" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "CompanySubmission" ADD COLUMN IF NOT EXISTS "defaultAdditionalRate" DOUBLE PRECISION`);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}
