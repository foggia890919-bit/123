import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSmsOtpTable } from "@/lib/ensure-sms-otp-table";

export async function POST(req: NextRequest) {
  try {
    await ensureSmsOtpTable();
    const { phone, code } = await req.json();
    const digits = String(phone ?? "").replace(/\D/g, "");
    const codeStr = String(code ?? "").trim();

    if (!digits || !codeStr) {
      return NextResponse.json({ error: "전화번호와 인증코드를 입력해주세요." }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<{ code: string; expiresAt: Date; verified: boolean }[]>(
      `SELECT "code","expiresAt","verified" FROM "SmsOtp" WHERE "phone"=$1 ORDER BY "createdAt" DESC LIMIT 1`,
      digits
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "인증코드를 먼저 발송해주세요." }, { status: 400 });
    }

    const otp = rows[0];
    if (new Date(otp.expiresAt) < new Date()) {
      return NextResponse.json({ error: "인증코드가 만료됐어요. 다시 발송해주세요." }, { status: 400 });
    }
    if (otp.code !== codeStr) {
      return NextResponse.json({ error: "인증코드가 일치하지 않아요." }, { status: 400 });
    }

    // 인증 완료 표시
    await prisma.$executeRawUnsafe(
      `UPDATE "SmsOtp" SET "verified"=true WHERE "phone"=$1`,
      digits
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "인증 실패" }, { status: 500 });
  }
}
