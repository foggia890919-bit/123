import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export const runtime = "nodejs";
export const maxDuration = 30;

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

// GET /api/email-ingest/attachment/[id]
// Proxies the file from Supabase Storage so raw URLs are never exposed to the client.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  const attachment = await prisma.emailAttachment.findUnique({ where: { id } });
  if (!attachment) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "STORAGE_NOT_CONFIGURED" }, { status: 503 });
  }

  const bucket = "incoming-emails";
  const url = `${process.env.SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${encodeURI(attachment.fileKey)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "STORAGE_FETCH_FAILED" }, { status: 502 });
  }

  const buf = await res.arrayBuffer();
  const body = new Uint8Array(buf);
  const contentType = res.headers.get("content-type") ?? attachment.mimeType ?? "application/octet-stream";

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
