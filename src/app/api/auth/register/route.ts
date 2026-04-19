import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const { email, password, name, role, phone, carrier, document } = await req.json();

  if (!email || !password || !name) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "이미 사용 중인 이메일이에요." }, { status: 409 });
  }

  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email, password: hashed, name,
      role: role || "SALES_REP",
      phone: phone || null,
      carrier: carrier || null,
      approved: false,
      updatedAt: new Date(),
    },
    select: { id: true, email: true, name: true, role: true },
  });

  if (document?.fileData && document?.fileName) {
    await prisma.userDocument.create({
      data: {
        userId: user.id,
        docType: document.docType || "기타",
        fileName: document.fileName,
        fileData: document.fileData,
      },
    });
  }

  return NextResponse.json(user, { status: 201 });
}
