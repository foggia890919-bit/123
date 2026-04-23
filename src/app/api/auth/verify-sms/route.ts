import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSmsOtpTable } from "@/lib/ensure-sms-otp-table";
import bcrypt from "bcryptjs";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    await ensureSmsOtpTable();
    const { phone, code } = await req.json();
    const digits = String(phone ?? "").replace(/\D/g, "");
    const codeStr = String(code ?? "").trim();

    if (!digits || !codeStr) {
      return NextResponse.json({ error: "전화번호와 인증코드를 입력해주세요." }, { status: 400 });
    }
    // 10 attempts per phone per 5 min — blocks brute force of 6-digit codes
    const rl = rateLimit(`verify:${digits}`, 10, 300);
    if (!rl.ok) {
      return NextResponse.json({ error: "인증 시도가 너무 많아요. 잠시 후 다시 시도해주세요." }, { status: 429 });
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
    // 해시 비교 — 평문 코드는 DB에 저장되지 않음
    const match = await bcrypt.compare(codeStr, otp.code);
    if (!match) {
      return NextResponse.json({ error: "인증코드가 일치하지 않아요." }, { status: 400 });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "SmsOtp" SET "verified"=true WHERE "phone"=$1`,
      digits
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "인증 실패" }, { status: 500 });
  }
}
