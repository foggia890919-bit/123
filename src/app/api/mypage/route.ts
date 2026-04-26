import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function PATCH(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;
  const { currentPassword, newPassword } = await req.json();

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "새 비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return NextResponse.json({ error: "사용자 없음" }, { status: 404 });

  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) return NextResponse.json({ error: "현재 비밀번호가 올바르지 않아요." }, { status: 401 });

  const hashed = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: session.id },
    data: { password: hashed, updatedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
