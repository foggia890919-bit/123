"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
// 권장 설정: Supabase Transaction Pooler (port 6543) 사용
// DATABASE_URL 예: postgres://...@aws-0-xxx.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
// Session pooler(5432)는 전역 15 클라이언트 한계 때문에 sync 중 EMAXCONNSESSION 발생 가능
function createPrismaClient() {
    const pool = new pg_1.Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
        idleTimeoutMillis: 5000,
        connectionTimeoutMillis: 10000,
    });
    const adapter = new adapter_pg_1.PrismaPg(pool);
    return new client_1.PrismaClient({ adapter });
}
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production")
    globalForPrisma.prisma = exports.prisma;
