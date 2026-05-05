// KMD 사용자 검색 — ePharms 계정의 kmdUserId 매핑용 자동완성.
// 계층 필터: ADMIN → 전체 / 그 외 → 본인+상위+하위만 반환.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

/** 주어진 userId의 모든 하위 userId를 재귀적으로 수집 (최대 5단계). */
async function collectDescendants(userId: string, depth = 0): Promise<string[]> {
  if (depth >= 5) return [];
  const children = await prisma.user.findMany({
    where: { parentUserId: userId },
    select: { id: true },
  });
  if (children.length === 0) return [];
  const ids = children.map((c) => c.id);
  const deeper = await Promise.all(ids.map((id) => collectDescendants(id, depth + 1)));
  return [...ids, ...deeper.flat()];
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  // ADMIN → 전체 검색
  if (user.role === "ADMIN") {
    const users = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : {},
      select: { id: true, email: true, name: true, role: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      take: 50,
    });
    return NextResponse.json({ items: users });
  }

  // 비-ADMIN: 본인 + 상위(parent) + 모든 하위(descendants)
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { parentUserId: true },
  });

  const allowedIds = new Set<string>();
  allowedIds.add(user.id);
  if (me?.parentUserId) allowedIds.add(me.parentUserId);
  const descendants = await collectDescendants(user.id);
  descendants.forEach((id) => allowedIds.add(id));

  const users = await prisma.user.findMany({
    where: {
      id: { in: Array.from(allowedIds) },
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    select: { id: true, email: true, name: true, role: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    take: 50,
  });

  return NextResponse.json({ items: users });
}
