import { NextRequest, NextResponse } from "next/server";
import { isNextResponse, requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const { id } = await params;
  const order = await prisma.inhouseOrder.findUnique({
    where: { id },
    include: {
      items: true,
      user: { select: { id: true, name: true, email: true, salesCode: true } },
    },
  });
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const isStaff = user.role === "BIZ" || user.role === "ADMIN";
  if (!isStaff && order.userId !== user.id)
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  return NextResponse.json({ order });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { status } = body as { status?: string };

  const validStatuses = ["PENDING", "CONFIRMED", "ORDERED", "REJECTED"];
  if (!status || !validStatuses.includes(status))
    return NextResponse.json({ error: `status must be one of: ${validStatuses.join(", ")}` }, { status: 400 });

  const now = new Date();
  const updated = await prisma.inhouseOrder.update({
    where: { id },
    data: {
      status: status as never,
      ...(status === "CONFIRMED" ? { confirmedAt: now } : {}),
      ...(status === "ORDERED" ? { orderedAt: now } : {}),
    },
    include: { items: true },
  });

  return NextResponse.json({ order: updated });
}
