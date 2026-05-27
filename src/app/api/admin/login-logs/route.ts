import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { paginationParams } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { page, limit, skip } = paginationParams(req.nextUrl.searchParams, { defaultLimit: 50, maxLimit: 50, maxPage: 10000 });
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const successParam = req.nextUrl.searchParams.get("success");

  const where: Record<string, unknown> = {};

  if (q) {
    (where as { OR?: unknown[] }).OR = [
      { email: { contains: q, mode: "insensitive" } },
      { user: { name: { contains: q, mode: "insensitive" } } },
      { user: { phone: { contains: q, mode: "insensitive" } } },
    ];
  }
  if (successParam === "true") where.success = true;
  if (successParam === "false") where.success = false;

  const [logs, total] = await Promise.all([
    prisma.loginLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      include: { user: { select: { name: true, role: true, phone: true, email: true } } },
    }),
    prisma.loginLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total, page, limit });
}
