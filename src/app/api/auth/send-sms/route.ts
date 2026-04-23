import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSmsOtpTable } from "@/lib/ensure-sms-otp-table";
import { sendSms } from "@/lib/coolsms";
import { randomUUID } from "crypto";

const RATE_LIMIT_MS = 60_000; // 1분에 1번만 발송

export async function POST(req: NextRequest) {
  try {
    await ensureSmsOtpTable();
    const { phone } = await req.json();
    const digits = String(phone ?? "").replace(/\D/g, "");
    if (!/^010\d{8}$/.test(digits)) {
      return NextResponse.json({ error: "올바른 휴대폰 번호를 입력해주세요. (010-XXXX-XXXX)" }, { status: 400 });
    }

    // 1분 이내 재발송 방지
    const recent = await prisma.$queryRawUnsafe<{ createdAt: Date }[]>(
      `SELECT "createdAt" FROM "SmsOtp" WHERE "phone"=$1 AND "createdAt" > NOW() - INTERVAL '1 minute' LIMIT 1`,
      digits
    );
    if (recent.length > 0) {
      return NextResponse.json({ error: "1분 후에 다시 시도해주세요." }, { status: 429 });
    }

    // 기존 OTP 삭제
    await prisma.$executeRawUnsafe(`DELETE FROM "SmsOtp" WHERE "phone"=$1`, digits);

    // 6자리 코드 생성
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60_000); // 5분 유효

    await prisma.$executeRawUnsafe(
      `INSERT INTO "SmsOtp" ("id","phone","code","verified","expiresAt") VALUES ($1,$2,$3,false,$4)`,
      randomUUID(), digits, code, expiresAt.toISOString()
    );

    await sendSms(digits, `[인증] 본인확인 인증번호는 [${code}]입니다. 5분 내에 입력해주세요.`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "발송 실패" }, { status: 500 });
  }
}
