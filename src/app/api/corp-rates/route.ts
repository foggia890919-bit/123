import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

function bizOrAdmin(role: string) { return role === "BIZ" || role === "ADMIN"; }

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const corpName = req.nextUrl.searchParams.get("corpName");
  const rows = await prisma.corpCompanyRate.findMany({
    where: corpName ? { corpName: { contains: corpName, mode: "insensitive" } } : {},
    orderBy: [{ corpName: "asc" }, { companyName: "asc" }],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { corpName, companyName, additionalRate, memo } = await req.json();
  if (!corpName || !companyName)
    return NextResponse.json({ error: "법인명과 제약사명은 필수입니다." }, { status: 400 });

  const row = await prisma.corpCompanyRate.upsert({
    where: { corpName_companyName: { corpName, companyName } },
    create: { id: crypto.randomUUID(), corpName, companyName, additionalRate: additionalRate ?? 0, memo: memo || null, updatedAt: new Date() },
    update: { additionalRate: additionalRate ?? 0, memo: memo || null, updatedAt: new Date() },
  });
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id, additionalRate, memo } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const row = await prisma.corpCompanyRate.update({
    where: { id },
    data: {
      ...(additionalRate !== undefined ? { additionalRate } : {}),
      ...(memo !== undefined ? { memo: memo || null } : {}),
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
  await prisma.corpCompanyRate.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
