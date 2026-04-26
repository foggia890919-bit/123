import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse, safeParseInt } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const page = safeParseInt(req.nextUrl.searchParams.get("page"), 1, 1, 10000);
  const limit = 50;
  const skip = (page - 1) * limit;
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
