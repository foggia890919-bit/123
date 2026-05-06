import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSmsOtpTable } from "@/lib/ensure-sms-otp-table";
import bcrypt from "bcryptjs";
import { BUCKETS, persistDataUri } from "@/lib/storage";

export async function POST(req: NextRequest) {
  try {
    await ensureSmsOtpTable();
    const { email, password, name, role, phone, carrier, document } = await req.json();

    if (!email || !password || !name) {
      return NextResponse.json({ error: "필수 항목을 입력해주세요." }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
    }
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "올바른 이메일 주소를 입력해주세요." }, { status: 400 });
    }

    const digits = String(phone ?? "").replace(/\D/g, "");
    if (!digits) {
      return NextResponse.json({ error: "전화번호를 입력해주세요." }, { status: 400 });
    }

    // 휴대폰 인증 완료 여부 확인 (시간 제한 없음 — 인증 후 가입 완료 시 삭제됨)
    const verified = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "SmsOtp"
       WHERE "phone"=$1 AND "verified"=true
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

    const validRoles = ["SALES_REP", "BIZ", "BASIC", "DOCTOR", "PHARMACIST"];
    const safeRole = validRoles.includes(role) ? role : "SALES_REP";

    const hashed = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email, password: hashed, name,
        role: safeRole,
        phone: phone || null,
        carrier: carrier || null,
        approved: true,
        updatedAt: new Date(),
      },
      select: { id: true, email: true, name: true, role: true },
    });

    if (document?.fileData && document?.fileName) {
      const { fileKey, fileData } = await persistDataUri(BUCKETS.userDocument, user.id, document.fileData);
      await prisma.userDocument.create({
        data: {
          userId: user.id,
          docType: document.docType || "기타",
          fileName: document.fileName,
          fileKey,
          fileData,
        },
      });
    }

    await prisma.$executeRawUnsafe(`DELETE FROM "SmsOtp" WHERE "phone"=$1`, digits);

    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    console.error("[register]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `서버 오류: ${msg}` }, { status: 500 });
  }
}
