import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { normalizeCompanyName } from "@/lib/company-name";

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const companyName = searchParams.get("companyName");
  const active = searchParams.get("active");

  const mappings = await prisma.filterMapping.findMany({
    where: {
      ...(companyName ? { companyName: { contains: companyName } } : {}),
      ...(active !== null ? { active: active === "true" } : {}),
    },
    orderBy: { companyName: "asc" },
  });

  return NextResponse.json(mappings);
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const companyName = normalizeCompanyName(String(body.companyName ?? "").trim());
  const submissionEntity = normalizeCompanyName(String(body.submissionEntity ?? "").trim());
  const { managerName, managerPhone, notes } = body;

  if (!companyName || !submissionEntity) {
    return NextResponse.json({ error: "제약사명과 제출처는 필수입니다." }, { status: 400 });
  }

  const mapping = await prisma.filterMapping.upsert({
    where: { companyName },
    create: {
      id: crypto.randomUUID(),
      companyName,
      submissionEntity,
      managerName: managerName || null,
      managerPhone: managerPhone || null,
      notes: notes || null,
      updatedAt: new Date(),
    },
    update: {
      submissionEntity,
      managerName: managerName || null,
      managerPhone: managerPhone || null,
      notes: notes || null,
      active: true,
      updatedAt: new Date(),
    },
  });

  return NextResponse.json(mapping, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id, submissionEntity, managerName, managerPhone, notes, active } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const mapping = await prisma.filterMapping.update({
    where: { id },
    data: {
      ...(submissionEntity !== undefined ? { submissionEntity } : {}),
      ...(managerName !== undefined ? { managerName: managerName || null } : {}),
      ...(managerPhone !== undefined ? { managerPhone: managerPhone || null } : {}),
      ...(notes !== undefined ? { notes: notes || null } : {}),
      ...(active !== undefined ? { active } : {}),
      updatedAt: new Date(),
    },
  });

  return NextResponse.json(mapping);
}

export async function DELETE(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  await prisma.filterMapping.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
