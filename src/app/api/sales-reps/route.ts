import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const reps = await prisma.user.findMany({
    where: {
      role: "SALES_REP",
      ...(q ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { salesCode: { contains: q, mode: "insensitive" } },
        ],
      } : {}),
    },
    select: {
      id: true, name: true, email: true, phone: true,
      approved: true, salesCode: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(reps);
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id, approved, salesCode } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (approved !== undefined) data.approved = Boolean(approved);
  if (salesCode !== undefined) data.salesCode = salesCode || null;

  const updated = await prisma.user.update({ where: { id }, data });
  return NextResponse.json({
    id: updated.id, name: updated.name, email: updated.email,
    phone: updated.phone, approved: updated.approved, salesCode: updated.salesCode,
  });
}
