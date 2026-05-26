import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { paginationParams } from "@/lib/pagination";

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
  const { page, limit, skip } = paginationParams(sp);

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
