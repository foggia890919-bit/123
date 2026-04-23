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

export async function requireRole(minRole: string): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const hierarchy: Record<string, number> = {
    BASIC: 0, DOCTOR: 0, PHARMACIST: 0,
    SALES_REP: 1, BIZ: 2, ADMIN: 99,
  };
  if (user.role === "ADMIN") return user;
  if ((hierarchy[user.role] ?? -1) < (hierarchy[minRole] ?? 99)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return user;
}

export function isNextResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}

export function safeParseInt(v: string | null | undefined, fallback: number, min = 0, max = 1_000_000): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
