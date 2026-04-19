import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// 권장 설정: Supabase Transaction Pooler (port 6543) 사용
// DATABASE_URL 예: postgres://...@aws-0-xxx.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
// Session pooler(5432)는 전역 15 클라이언트 한계 때문에 sync 중 EMAXCONNSESSION 발생 가능
function createPrismaClient() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
