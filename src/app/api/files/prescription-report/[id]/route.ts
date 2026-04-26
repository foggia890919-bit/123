import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, readFileAsDataUri } from "@/lib/storage";

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const { id } = await context.params;
  const row = await prisma.prescriptionReport.findUnique({
    where: { id },
    select: { id: true, userId: true, imageData: true, imageKey: true },
  });
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (user.role !== "ADMIN" && row.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const imageData = await readFileAsDataUri(BUCKETS.prescriptionImage, {
    fileKey: row.imageKey,
    fileData: row.imageData,
  });
  return NextResponse.json({ id: row.id, imageData });
}
