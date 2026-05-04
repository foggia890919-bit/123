// KMD 사용자 검색 — ePharms 계정의 kmdUserId 매핑용 자동완성.
// BIZ/ADMIN 만 접근 가능. 이메일/이름/전화로 검색.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

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
