import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSmsOtpTable } from "@/lib/ensure-sms-otp-table";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  await ensureSmsOtpTable();
  const { email, password, name, role, phone, carrier, document } = await req.json();

  if (!email || !password || !name) {
    return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
  }

  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) {
    return NextResponse.json({ error: "전화번호를 입력해주세요." }, { status: 400 });
  }

  // 휴대폰 인증 완료 여부 확인 (10분 이내 인증)
  const verified = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "SmsOtp"
     WHERE "phone"=$1 AND "verified"=true AND "expiresAt" > NOW() - INTERVAL '5 minutes'
     ORDER BY "createdAt" DESC LIMIT 1`,
    digits
  );
  if (verified.length === 0) {
    return NextResponse.json({ error: "휴대폰 본인인증을 완료해주세요." }, { status: 400 });
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

  // OTP 사용 완료 처리
  await prisma.$executeRawUnsafe(`DELETE FROM "SmsOtp" WHERE "phone"=$1`, digits);

  return NextResponse.json(user, { status: 201 });
}
