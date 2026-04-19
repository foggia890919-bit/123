import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, email: true, name: true, role: true,
      approved: true, phone: true, carrier: true, createdAt: true,
      documents: { select: { id: true, docType: true, fileName: true, fileData: true } },
    },
  });
  return NextResponse.json(users);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();

  // 승인/거절
  if ("approved" in body) {
    const user = await prisma.user.update({
      where: { id: body.userId },
      data: { approved: body.approved, updatedAt: new Date() },
      select: { id: true, approved: true },
    });
    return NextResponse.json(user);
  }

  // 비밀번호 초기화
  if ("newPassword" in body) {
    const hashed = await bcrypt.hash(body.newPassword, 10);
    await prisma.user.update({
      where: { id: body.userId },
      data: { password: hashed, updatedAt: new Date() },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
}
