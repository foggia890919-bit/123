import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { id } = await params;
  const body = await req.json();
  const board = await prisma.board.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.slug !== undefined && { slug: body.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-") }),
      ...(body.description !== undefined && { description: body.description || null }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.order !== undefined && { order: body.order }),
      ...(body.active !== undefined && { active: body.active }),
    },
  });
  return NextResponse.json(board);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { id } = await params;
  await prisma.board.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
