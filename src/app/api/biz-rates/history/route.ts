import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, safeParseInt } from "@/lib/auth-guard";

export const runtime = "nodejs";

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

// GET /api/biz-rates/history?corpClientId&companyName&applyMonth&action&page&limit
export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const corpClientId = sp.get("corpClientId") ?? undefined;
  const companyName = sp.get("companyName") ?? undefined;
  const applyMonth = sp.get("applyMonth") ?? undefined;
  const action = sp.get("action") ?? undefined;
  const page = safeParseInt(sp.get("page"), 1, 1);
  const limit = safeParseInt(sp.get("limit"), 20, 1, 100);
  const skip = (page - 1) * limit;

  const where = {
    ...(corpClientId ? { corpClientId } : {}),
    ...(companyName ? { companyName: { contains: companyName, mode: "insensitive" as const } } : {}),
    ...(applyMonth ? { applyMonth } : {}),
    ...(action ? { action } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.corpRateFileHistory.count({ where }),
    prisma.corpRateFileHistory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        rateFileId: true,
        corpClientId: true,
        companyName: true,
        applyMonth: true,
        action: true,
        prevFileKey: true,
        prevFileName: true,
        newFileKey: true,
        newFileName: true,
        createdAt: true,
        performedBy: { select: { name: true } },
      },
    }),
  ]);

  return NextResponse.json({ total, page, limit, items });
}
