import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { sendSms } from "@/lib/coolsms";
import { sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";

function generateTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function normalizePhone(s: string) {
  return String(s).replace(/\D/g, "");
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // method: "email" | "phone"
  const method: "email" | "phone" = body.method ?? (body.email && !body.phone ? "email" : "phone");
  const value: string = (method === "email" ? body.email : body.phone) ?? "";

  if (!value.trim()) {
    return NextResponse.json({ error: "입력값이 없어요." }, { status: 400 });
  }

  const rlKey = `forgot:${method}:${value.toLowerCase()}`;
  const rl = rateLimit(rlKey, 3, 600);
  if (!rl.ok) {
    return NextResponse.json({ error: "요청이 너무 많아요. 잠시 후 다시 시도해주세요." }, { status: 429 });
  }

  let user = null;

  if (method === "email") {
    user = await prisma.user.findUnique({ where: { email: value.trim().toLowerCase() } });
  } else {
    const digits = normalizePhone(value);
    user = await prisma.user.findFirst({ where: { phone: { contains: digits } } });
    // 정확히 일치하는 번호만 허용
    if (user && normalizePhone(user.phone ?? "") !== digits) user = null;
  }

  if (user) {
    const tempPw = generateTempPassword();
    const hashed = await bcrypt.hash(tempPw, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed, updatedAt: new Date() } });

    if (method === "email") {
      try {
        await sendEmail(
          user.email,
          "[KMD] 임시 비밀번호 안내",
          `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="color:#1d4ed8;margin-bottom:8px">임시 비밀번호 안내</h2>
            <p style="color:#374151">안녕하세요, <strong>${user.name ?? "회원"}</strong>님.</p>
            <p style="color:#374151">요청하신 임시 비밀번호가 발급되었습니다.</p>
            <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
              <span style="font-size:24px;font-weight:bold;letter-spacing:4px;color:#111827">${tempPw}</span>
            </div>
            <p style="color:#6b7280;font-size:13px">로그인 후 즉시 비밀번호를 변경해주세요.<br>본인이 요청하지 않은 경우 고객센터에 문의해주세요.</p>
          </div>`
        );
      } catch { /* 발송 실패해도 계정 노출 방지 */ }
    } else {
      const digits = normalizePhone(value);
      try {
        await sendSms(digits, `[KMD] 임시비밀번호: ${tempPw}\n로그인 후 즉시 변경해주세요.`);
      } catch { /* 발송 실패해도 계정 노출 방지 */ }
    }
  }

  // 항상 동일 응답 — 계정 존재 여부 노출 방지
  const dest = method === "email" ? "입력하신 이메일 주소" : "등록된 휴대폰";
  return NextResponse.json({
    ok: true,
    message: `등록된 정보가 일치하면 ${dest}로 임시 비밀번호를 발송합니다.`,
  });
}
