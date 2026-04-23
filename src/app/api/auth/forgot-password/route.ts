import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { sendSms } from "@/lib/coolsms";
import { rateLimit } from "@/lib/rate-limit";

function generateTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function normalizePhone(s: string) {
  return String(s).replace(/\D/g, "");
}

export async function POST(req: NextRequest) {
  const { email, phone } = await req.json();

  if (!email || !phone) {
    return NextResponse.json({ error: "이메일과 본인 휴대폰 번호를 모두 입력해주세요." }, { status: 400 });
  }

  // 이메일로 계정 조회 — 존재 여부는 응답으로 드러내지 않음 (정보 노출 방지)
  const user = await prisma.user.findUnique({ where: { email } });

  // 과도한 요청 방지 (이메일 기준 3회/10분)
  const rl = rateLimit(`forgot:${email.toLowerCase()}`, 3, 600);
  if (!rl.ok) {
    return NextResponse.json({ error: "요청이 너무 많아요. 잠시 후 다시 시도해주세요." }, { status: 429 });
  }

  // 등록된 휴대폰과 일치하는 경우에만 초기화 (소유 확인)
  const submittedDigits = normalizePhone(phone);
  const storedDigits = user?.phone ? normalizePhone(user.phone) : "";
  const ok = !!user && !!storedDigits && storedDigits === submittedDigits;

  if (ok && user) {
    const tempPw = generateTempPassword();
    const hashed = await bcrypt.hash(tempPw, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed, updatedAt: new Date() } });
    try {
      await sendSms(submittedDigits, `[임시비밀번호] ${tempPw}\n로그인 후 즉시 비밀번호를 변경해주세요.`);
    } catch {
      // SMS 발송 실패해도 응답은 동일하게 처리해서 계정 존재 여부를 노출하지 않음
    }
  }

  // 항상 동일한 응답 — 계정 존재 여부/전화 일치 여부가 응답으로 드러나지 않도록
  return NextResponse.json({ ok: true, message: "등록된 정보가 일치하면 휴대폰으로 임시 비밀번호를 발송합니다." });
}
