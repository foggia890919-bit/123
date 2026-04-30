import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, storageEnabled, newStorageKey, parseDataUri, uploadDataUri, deleteObject } from "@/lib/storage";

// GET /api/settlement/documents?period=2024-01
export async function GET(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const yearMonth = req.nextUrl.searchParams.get("yearMonth") ?? req.nextUrl.searchParams.get("period");
  const period = yearMonth ?? undefined;

  const docs = await prisma.settlementDocument.findMany({
    where: { userId: user.id, ...(period ? { period } : {}) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, corpName: true, fileName: true, period: true,
      status: true, parsedData: true, createdAt: true, templateId: true,
      template: { select: { corpName: true, columnMap: true } },
    },
  });
  return NextResponse.json(docs);
}

// POST /api/settlement/documents — upload a document
// Body: { corpName, fileName, fileData (base64), period }
export async function POST(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const { corpName, fileName, fileData, period } = await req.json();
  if (!corpName || !fileName || !period) {
    return NextResponse.json({ error: "corpName, fileName, period 필요" }, { status: 400 });
  }

  let fileKey = "";
  if (fileData && storageEnabled()) {
    const parsed = parseDataUri(fileData);
    if (parsed) {
      const ext = fileName.endsWith(".xlsx") ? "xlsx" : "xls";
      const key = newStorageKey(`${user.id}/docs/${period}`, ext);
      const { ok } = await uploadDataUri(BUCKETS.settlementDocument, key, fileData);
      if (ok) fileKey = key;
    }
  }

  // link to existing template if available
  const template = await prisma.settlementTemplate.findUnique({
    where: { userId_corpName: { userId: user.id, corpName } },
    select: { id: true },
  });

  const doc = await prisma.settlementDocument.create({
    data: {
      userId: user.id,
      templateId: template?.id ?? null,
      corpName,
      fileName,
      fileKey,
      period,
      status: "PENDING",
    },
  });
  return NextResponse.json(doc);
}

// PATCH /api/settlement/documents?id=xxx — update status / parsedData
export async function PATCH(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const doc = await prisma.settlementDocument.findUnique({ where: { id }, select: { userId: true } });
  if (!doc) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (doc.userId !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { status, parsedData } = await req.json();
  const updated = await prisma.settlementDocument.update({
    where: { id },
    data: { ...(status ? { status } : {}), ...(parsedData !== undefined ? { parsedData } : {}) },
  });
  return NextResponse.json(updated);
}

// DELETE /api/settlement/documents?id=xxx
export async function DELETE(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const doc = await prisma.settlementDocument.findUnique({ where: { id }, select: { userId: true, fileKey: true } });
  if (!doc) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (doc.userId !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (doc.fileKey) await deleteObject(BUCKETS.settlementDocument, doc.fileKey);
  await prisma.settlementDocument.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
