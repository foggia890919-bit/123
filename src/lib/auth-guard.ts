import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "./auth";

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
};

async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const u = session.user as Record<string, unknown>;
  if (!u.id || !u.role) return null;
  return {
    id: String(u.id),
    email: String(u.email ?? ""),
    name: (u.name as string | null) ?? null,
    role: String(u.role),
  };
}

export async function requireSession(): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return user;
}

export async function requireAdmin(): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return user;
}

export async function requireAdminOrService(req: Request): Promise<SessionUser | "SERVICE" | NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${secret}`) return "SERVICE";
  }
  return requireAdmin();
}

// superset HIERARCHY — 신구 enum 값 모두 동작 (Phase 8까지 유지).
const ROLE_HIERARCHY: Record<string, number> = {
  // 일반 사용자 레벨
  GENERAL: 0, BASIC: 0,
  HOSPITAL: 0, DOCTOR: 0,
  PHARMACY: 0, PHARMACIST: 0,
  // 영업 (CSO 기본)
  SALES: 1, BUSINESS: 1,
  // 비즈 관리자
  BIZ: 2,
  // 최상위
  ADMIN: 99,
};

export async function requireRole(minRole: string): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.role === "ADMIN") return user;
  if ((ROLE_HIERARCHY[user.role] ?? -1) < (ROLE_HIERARCHY[minRole] ?? 99)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return user;
}

export function isNextResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}

// 통계제출처 접근 허용 role — 병의원/약국/일반(직업 분류 가입자) 차단, CSO 분류 + 비즈/관리자만 허용.
// 신구 enum 값 모두 인식.
export function canManageSubmissionRoutes(role: string): boolean {
  return (
    role === "ADMIN" || role === "BIZ" ||
    role === "SALES" || role === "BUSINESS" ||
    role === "GENERAL" || role === "BASIC"  // 일반은 기존 동작 유지 (제출처 등록 가능)
  );
}

export function safeParseInt(v: string | null | undefined, fallback: number, min = 0, max = 1_000_000): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
