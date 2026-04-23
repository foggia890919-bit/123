import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
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
