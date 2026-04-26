import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { id } = await params;
  const body = await req.json();
  const notice = await prisma.notice.update({
    where: { id },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.isPinned !== undefined && { isPinned: body.isPinned }),
      ...(body.showAsPopup !== undefined && { showAsPopup: body.showAsPopup }),
      ...(body.popupUntil !== undefined && { popupUntil: body.popupUntil ? new Date(body.popupUntil) : null }),
    },
  });
  return NextResponse.json(notice);
}
