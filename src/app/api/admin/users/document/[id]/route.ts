import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const { id } = await context.params;
  const doc = await prisma.userDocument.findUnique({
    where: { id },
    select: { id: true, docType: true, fileName: true, fileData: true },
  });
  if (!doc) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(doc);
}
