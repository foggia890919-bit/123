import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, safeParseInt } from "@/lib/auth-guard";

export const runtime = "nodejs";

const VALID_STATUSES = ["PENDING", "CLASSIFIED", "PROCESSED", "FAILED", "IGNORED"] as const;
type EmailStatus = (typeof VALID_STATUSES)[number];

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

// GET /api/email-ingest/inbox?status=PENDING|CLASSIFIED|PROCESSED|FAILED|IGNORED|ALL&page=1&limit=20
export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const statusParam = (sp.get("status") ?? "ALL").toUpperCase();
  const page = safeParseInt(sp.get("page"), 1, 1);
  const limit = safeParseInt(sp.get("limit"), 20, 1, 100);
  const skip = (page - 1) * limit;

  const where =
    statusParam === "ALL"
      ? {}
      : VALID_STATUSES.includes(statusParam as EmailStatus)
        ? { status: statusParam as EmailStatus }
        : {};

  const [total, items] = await Promise.all([
    prisma.incomingEmail.count({ where }),
    prisma.incomingEmail.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip,
      take: limit,
      include: {
        attachments: {
          select: { id: true, fileName: true, mimeType: true, size: true, fileKey: true },
        },
      },
    }),
  ]);

  return NextResponse.json({ total, page, limit, items });
}
