import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, storageEnabled, newStorageKey, deleteObject } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

async function uploadFileToStorage(file: File, prefix: string): Promise<{ fileKey: string; error?: string }> {
  if (!storageEnabled()) {
    return { fileKey: "", error: "STORAGE_DISABLED" };
  }
  const ext = file.name.split(".").pop() ?? "bin";
  const key = newStorageKey(prefix, ext);
  const buf = await file.arrayBuffer();
  const url = `${process.env.SUPABASE_URL!.replace(/\/+$/, "")}/storage/v1/object/${BUCKETS.bizRateFile}/${encodeURI(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: new Uint8Array(buf),
  });
  if (!res.ok) {
    return { fileKey: "", error: `STORAGE_ERROR:${res.status}` };
  }
  return { fileKey: key };
}

// PATCH /api/biz-rates/[id]
//  - multipart/form-data {file}: 파일 교체
//  - application/json {columnMap}: 컬럼 매핑만 업데이트 (파일 교체 없음)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  const contentType = req.headers.get("content-type") ?? "";

  // JSON 본문 → 컬럼 매핑만 업데이트
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || !("columnMap" in body)) {
      return NextResponse.json({ error: "columnMap 필수" }, { status: 400 });
    }
    const existing = await prisma.corpRateFile.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    const updated = await prisma.corpRateFile.update({
      where: { id },
      data: { columnMap: body.columnMap ?? undefined },
    });
    return NextResponse.json(updated);
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "file 필수" }, { status: 400 });
  }

  const MAX_BYTES = 50 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 400 });
  }

  const existing = await prisma.corpRateFile.findUnique({
    where: { id },
    select: { id: true, corpClientId: true, companyName: true, applyMonth: true, fileKey: true, fileName: true },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const uploadResult = await uploadFileToStorage(file, `corp-rates/${existing.corpClientId}`);
  if (uploadResult.error) {
    return NextResponse.json({ error: uploadResult.error }, { status: 500 });
  }
  const newFileKey = uploadResult.fileKey;
  const newFileName = file.name;
  const prevFileKey = existing.fileKey;
  const prevFileName = existing.fileName;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.corpRateFile.update({
      where: { id },
      data: { fileName: newFileName, fileKey: newFileKey, uploadedById: user.id },
    });
    await tx.corpRateFileHistory.create({
      data: {
        id: crypto.randomUUID(),
        rateFileId: id,
        corpClientId: existing.corpClientId,
        companyName: existing.companyName,
        applyMonth: existing.applyMonth,
        action: "REPLACE",
        prevFileKey,
        prevFileName,
        newFileKey,
        newFileName,
        performedById: user.id,
      },
    });
    return u;
  });

  try {
    await deleteObject(BUCKETS.bizRateFile, prevFileKey);
  } catch {
    console.warn("[biz-rates/[id]] old file delete failed", prevFileKey);
  }

  return NextResponse.json(updated);
}

// DELETE /api/biz-rates/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.corpRateFile.findUnique({
    where: { id },
    select: { id: true, corpClientId: true, companyName: true, applyMonth: true, fileKey: true, fileName: true },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.corpRateFileHistory.create({
      data: {
        id: crypto.randomUUID(),
        rateFileId: id,
        corpClientId: existing.corpClientId,
        companyName: existing.companyName,
        applyMonth: existing.applyMonth,
        action: "DELETE",
        prevFileKey: existing.fileKey,
        prevFileName: existing.fileName,
        performedById: user.id,
      },
    });
    await tx.corpRateFile.delete({ where: { id } });
  });

  try {
    await deleteObject(BUCKETS.bizRateFile, existing.fileKey);
  } catch {
    console.warn("[biz-rates/[id]] file delete failed", existing.fileKey);
  }

  return NextResponse.json({ success: true });
}
