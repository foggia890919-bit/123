import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

// GET /api/biz-rates/download/[id]
// Server-proxied file download — never exposes publicUrl
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const rateFile = await prisma.corpRateFile.findUnique({
    where: { id },
    select: { fileKey: true, fileName: true },
  });
  if (!rateFile) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "STORAGE_DISABLED" }, { status: 503 });
  }

  const url = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/biz-rate-files/${encodeURI(rateFile.fileKey)}`;
  const storageRes = await fetch(url, {
    headers: { Authorization: `Bearer ${serviceKey}` },
  });
  if (!storageRes.ok) {
    return NextResponse.json({ error: "STORAGE_FETCH_FAILED" }, { status: 502 });
  }

  const blob = await storageRes.arrayBuffer();
  const encoded = encodeURIComponent(rateFile.fileName);

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
    },
  });
}
