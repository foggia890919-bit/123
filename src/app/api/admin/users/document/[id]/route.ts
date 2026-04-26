import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, readFileAsDataUri } from "@/lib/storage";

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const { id } = await context.params;
  const doc = await prisma.userDocument.findUnique({
    where: { id },
    select: { id: true, docType: true, fileName: true, fileData: true, fileKey: true },
  });
  if (!doc) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const fileData = await readFileAsDataUri(BUCKETS.userDocument, doc);
  return NextResponse.json({
    id: doc.id,
    docType: doc.docType,
    fileName: doc.fileName,
    fileData,
  });
}
