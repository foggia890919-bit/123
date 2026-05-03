import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

function bizOrAdmin(role: string) { return role === "BIZ" || role === "ADMIN"; }

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const rows = await prisma.coPromotion.findMany({
    where: q ? {
      OR: [
        { productName: { contains: q, mode: "insensitive" } },
        { statCompany: { contains: q, mode: "insensitive" } },
        { billingCompany: { contains: q, mode: "insensitive" } },
      ],
    } : {},
    orderBy: [{ statCompany: "asc" }, { productName: "asc" }],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { productName, statCompany, billingCompany, memo } = await req.json();
  if (!productName || !statCompany || !billingCompany)
    return NextResponse.json({ error: "품목명, 통계제약사, 정산제약사는 필수입니다." }, { status: 400 });

  const row = await prisma.coPromotion.upsert({
    where: { productName_statCompany: { productName, statCompany } },
    create: { id: crypto.randomUUID(), productName, statCompany, billingCompany, memo: memo || null, updatedAt: new Date() },
    update: { billingCompany, memo: memo || null, active: true, updatedAt: new Date() },
  });
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id, billingCompany, memo, active } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const row = await prisma.coPromotion.update({
    where: { id },
    data: {
      ...(billingCompany !== undefined ? { billingCompany } : {}),
      ...(memo !== undefined ? { memo: memo || null } : {}),
      ...(active !== undefined ? { active } : {}),
      updatedAt: new Date(),
    },
  });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });
  await prisma.coPromotion.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
