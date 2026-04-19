import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function PATCH(req: NextRequest) {
  const { userId, currentPassword, newPassword } = await req.json();

  if (!userId || !currentPassword || !newPassword) {
    return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "사용자 없음" }, { status: 404 });

  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) return NextResponse.json({ error: "현재 비밀번호가 올바르지 않아요." }, { status: 401 });

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed, updatedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
