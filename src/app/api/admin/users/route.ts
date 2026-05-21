import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { requireAdmin, isNextResponse, safeParseInt } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const page = safeParseInt(req.nextUrl.searchParams.get("page"), 1, 1, 10000);
  const limit = safeParseInt(req.nextUrl.searchParams.get("limit"), 50, 1, 200);
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (q) {
    (where as { OR?: unknown[] }).OR = [
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      select: {
        id: true, email: true, name: true, role: true,
        approved: true, phone: true, carrier: true, createdAt: true,
        documents: { select: { id: true, docType: true, fileName: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return NextResponse.json({ users, total, page, limit });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const body = await req.json();
  if (!body.userId || typeof body.userId !== "string") {
    return NextResponse.json({ error: "userId 필수" }, { status: 400 });
  }

  if ("approved" in body) {
    const user = await prisma.user.update({
      where: { id: body.userId },
      data: { approved: !!body.approved, updatedAt: new Date() },
      select: { id: true, approved: true },
    });
    return NextResponse.json(user);
  }

  if ("role" in body) {
    const validRoles = ["ADMIN", "BUSINESS", "BIZ", "BASIC", "DOCTOR", "PHARMACIST"];
    if (!validRoles.includes(body.role)) {
      return NextResponse.json({ error: "잘못된 역할" }, { status: 400 });
    }
    const user = await prisma.user.update({
      where: { id: body.userId },
      data: { role: body.role, updatedAt: new Date() },
      select: { id: true, role: true },
    });
    return NextResponse.json(user);
  }

  if ("newPassword" in body) {
    if (typeof body.newPassword !== "string" || body.newPassword.length < 8) {
      return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
    }
    const hashed = await bcrypt.hash(body.newPassword, 12);
    await prisma.user.update({
      where: { id: body.userId },
      data: { password: hashed, updatedAt: new Date() },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const body = await req.json();

  if (body?.action === "bulkApprove") {
    const result = await prisma.user.updateMany({
      where: { approved: false },
      data: { approved: true, updatedAt: new Date() },
    });
    return NextResponse.json({ count: result.count });
  }

  return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
}
