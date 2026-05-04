import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS } from "@/lib/storage";

async function fetchFileBuffer(bucket: string, key: string): Promise<Buffer | null> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const url = `${process.env.SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${encodeURI(key)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// GET /api/settlement/documents/download?id={docId}
export async function GET(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const doc = await prisma.settlementDocument.findUnique({
    where: { id },
    select: { userId: true, fileKey: true, fileName: true },
  });

  if (!doc) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!doc.fileKey || doc.fileKey === "") return NextResponse.json({ error: "파일이 없습니다" }, { status: 404 });
  if (doc.userId !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const buf = await fetchFileBuffer(BUCKETS.settlementDocument, doc.fileKey);
  if (!buf) return NextResponse.json({ error: "파일을 불러올 수 없습니다" }, { status: 404 });

  const encodedName = encodeURIComponent(doc.fileName ?? "settlement.xlsx");
  const body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

  return new NextResponse(body as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
    },
  });
}
