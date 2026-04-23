import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { id: boardId, userId } = await params;
  await prisma.boardEditor.deleteMany({ where: { boardId, userId } });
  return NextResponse.json({ ok: true });
}
