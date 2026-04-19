import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

function generateTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: "이메일을 입력해주세요." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return NextResponse.json({ error: "등록되지 않은 이메일이에요." }, { status: 404 });

  const tempPw = generateTempPassword();
  const hashed = await bcrypt.hash(tempPw, 10);
  await prisma.user.update({ where: { email }, data: { password: hashed, updatedAt: new Date() } });

  return NextResponse.json({ tempPassword: tempPw });
}
