import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSmsOtpTable } from "@/lib/ensure-sms-otp-table";
import { sendSms } from "@/lib/coolsms";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { rateLimit } from "@/lib/rate-limit";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  try {
    await ensureSmsOtpTable();
    const { phone } = await req.json();
    const digits = String(phone ?? "").replace(/\D/g, "");
    if (!/^010\d{8}$/.test(digits)) {
      return NextResponse.json({ error: "올바른 휴대폰 번호를 입력해주세요. (010-XXXX-XXXX)" }, { status: 400 });
    }

    // Per-phone: 5 per 10 min; Per-IP: 15 per 10 min (blocks bursts)
    const byPhone = rateLimit(`sms:phone:${digits}`, 5, 600);
    const byIp = rateLimit(`sms:ip:${clientIp(req)}`, 15, 600);
    if (!byPhone.ok || !byIp.ok) {
      return NextResponse.json({ error: "요청이 너무 많아요. 잠시 후 다시 시도해주세요." }, { status: 429 });
    }

    // 1분 이내 재발송 방지 (DB 기준 — 서버 재기동에도 유효)
    const recent = await prisma.$queryRawUnsafe<{ createdAt: Date }[]>(
      `SELECT "createdAt" FROM "SmsOtp" WHERE "phone"=$1 AND "createdAt" > NOW() - INTERVAL '1 minute' LIMIT 1`,
      digits
    );
    if (recent.length > 0) {
      return NextResponse.json({ error: "1분 후에 다시 시도해주세요." }, { status: 429 });
    }

    await prisma.$executeRawUnsafe(`DELETE FROM "SmsOtp" WHERE "phone"=$1`, digits);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    // OTP는 평문이 아닌 해시로 저장 — DB 덤프 시 코드 노출 방지
    const codeHash = await bcrypt.hash(code, 8);
    const expiresAt = new Date(Date.now() + 5 * 60_000);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "SmsOtp" ("id","phone","code","verified","expiresAt") VALUES ($1,$2,$3,false,$4)`,
      randomUUID(), digits, codeHash, expiresAt.toISOString()
    );

    await sendSms(digits, `[인증] 본인확인 인증번호는 [${code}]입니다. 5분 내에 입력해주세요.`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "발송 실패" }, { status: 500 });
  }
}
