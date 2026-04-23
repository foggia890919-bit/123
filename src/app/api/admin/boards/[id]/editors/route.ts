import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { id } = await params;
  const editors = await prisma.boardEditor.findMany({
    where: { boardId: id },
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  return NextResponse.json(editors);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { id: boardId } = await params;
  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId 필수" }, { status: 400 });
  const editor = await prisma.boardEditor.upsert({
    where: { boardId_userId: { boardId, userId } },
    create: { boardId, userId },
    update: {},
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  });
  return NextResponse.json(editor);
}
