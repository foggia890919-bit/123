import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, storageEnabled, newStorageKey, parseDataUri, uploadDataUri, deleteObject } from "@/lib/storage";

// GET /api/settlement/templates
export async function GET(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const templates = await prisma.settlementTemplate.findMany({
    where: { userId: user.id },
    orderBy: { corpName: "asc" },
    select: { id: true, corpName: true, fileName: true, columnMap: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json(templates);
}

// POST /api/settlement/templates  — create or update template
// Body: { corpName, fileName, fileData (base64), columnMap }
export async function POST(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const { corpName, fileName, fileData, columnMap } = await req.json();
  if (!corpName || !fileName) {
    return NextResponse.json({ error: "corpName, fileName 필요" }, { status: 400 });
  }

  let fileKey: string | null = null;
  if (fileData && storageEnabled()) {
    const parsed = parseDataUri(fileData);
    if (parsed) {
      const ext = fileName.endsWith(".xlsx") ? "xlsx" : "xls";
      const key = newStorageKey(`${user.id}/templates`, ext);
      const { ok } = await uploadDataUri(BUCKETS.settlementTemplate, key, fileData);
      if (ok) fileKey = key;
    }
  }

  // upsert by (userId, corpName)
  const existing = await prisma.settlementTemplate.findUnique({
    where: { userId_corpName: { userId: user.id, corpName } },
    select: { id: true, fileKey: true },
  });

  if (existing) {
    if (existing.fileKey && fileKey) {
      await deleteObject(BUCKETS.settlementTemplate, existing.fileKey);
    }
    const updated = await prisma.settlementTemplate.update({
      where: { id: existing.id },
      data: {
        fileName,
        fileKey: fileKey ?? existing.fileKey,
        columnMap: columnMap ?? {},
      },
    });
    return NextResponse.json(updated);
  }

  const created = await prisma.settlementTemplate.create({
    data: {
      userId: user.id,
      corpName,
      fileName,
      fileKey: fileKey ?? "",
      columnMap: columnMap ?? {},
    },
  });
  return NextResponse.json(created);
}

// DELETE /api/settlement/templates?id=xxx
export async function DELETE(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const tmpl = await prisma.settlementTemplate.findUnique({ where: { id }, select: { userId: true, fileKey: true } });
  if (!tmpl) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (tmpl.userId !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (tmpl.fileKey) await deleteObject(BUCKETS.settlementTemplate, tmpl.fileKey);
  await prisma.settlementTemplate.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
