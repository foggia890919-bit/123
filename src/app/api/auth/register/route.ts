import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSmsOtpTable } from "@/lib/ensure-sms-otp-table";
import bcrypt from "bcryptjs";
import { BUCKETS, persistDataUri } from "@/lib/storage";

export async function POST(req: NextRequest) {
  try {
    await ensureSmsOtpTable();
    const { email, password, name, role, phone, carrier, document, biz, bizDocument } = await req.json();

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

    // 가입은 의사(HOSPITAL)/약사(PHARMACY)/일반(GENERAL) 3가지만.
    // CSO 분류(SALES/BIZ)는 관리자가 회원관리에서 전환. legacy 값은 normalize.
    const allowedSelfRegister = ["HOSPITAL", "PHARMACY", "GENERAL", "DOCTOR", "PHARMACIST", "BASIC"];
    const { normalizeRole } = await import("@/lib/roles");
    const safeRole = normalizeRole(allowedSelfRegister.includes(role) ? role : "GENERAL");

    const hashed = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email, password: hashed, name,
        role: safeRole,
        phone: phone || null,
        carrier: carrier || null,
        approved: true,
        // 신규 회원은 default 일반회원 (isBusinessApproved=false).
        // 가입 후 마이페이지에서 사업자등록증 제출 + 관리자 승인 시 true 로 전환.
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

    if (biz?.bizNumber && biz?.clientName) {
      const { fileKey: bizFileKey, fileData: bizDocFallback } = await persistDataUri(
        BUCKETS.userClientBiz,
        user.id,
        bizDocument?.fileData ?? null
      );
      try {
        await prisma.userClient.create({
          data: {
            userId: user.id,
            clientName: biz.clientName,
            bizNumber: biz.bizNumber,
            address: biz.address ?? null,
            bizDocument: bizDocFallback,
            bizFileKey: bizFileKey ?? null,
            bizFileName: bizDocument?.fileName ?? null,
            dealerType: null,
            approved: true,
          },
        });
      } catch {
        try {
          await prisma.userClient.create({
            data: {
              userId: user.id,
              clientName: biz.clientName,
              bizNumber: biz.bizNumber,
              bizDocument: bizDocFallback,
              bizFileKey: bizFileKey ?? null,
              bizFileName: bizDocument?.fileName ?? null,
              dealerType: null,
              approved: true,
            },
          });
        } catch {
          // silently skip — don't fail registration if UserClient creation fails
        }
      }
    }

    // 가입 직후 사업자 인증 안내 알람 즉시 생성 — 가입자가 다음 로그인 시 종 아이콘에 빨강 배지로 확인.
    await prisma.notification.create({
      data: {
        userId: user.id,
        type: "BUSINESS_PROMPT",
        title: "사업자 등록하고 모든 기능을 사용해보세요",
        body: "지금은 통합검색만 이용 가능해요. 마이페이지에서 사업자등록증을 등록하고 관리자 승인을 받으면 제약사 필터링·통계제출처·제안서·통계 업로드 등 모든 기능을 사용할 수 있어요.",
        link: "/mypage",
      },
    }).catch(() => undefined);

    await prisma.$executeRawUnsafe(`DELETE FROM "SmsOtp" WHERE "phone"=$1`, digits);

    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    console.error("[register]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `서버 오류: ${msg}` }, { status: 500 });
  }
}
