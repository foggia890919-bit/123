import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

// 회원 알람 — 사업자 미인증 안내, 공지, 연결요청 등.
//
// GET    /api/notifications           본인 알람 list (최신순, max 30) + unreadCount
//                                     + 사업자 미인증이면 BUSINESS_PROMPT 자동 생성 (1회)
// PATCH  /api/notifications           body { id, isRead }  — 특정 알람 읽음 토글
//                                     body { allRead: true } — 전체 읽음
// DELETE /api/notifications?id=...    특정 알람 삭제

export const runtime = "nodejs";

const BUSINESS_PROMPT_TYPE = "BUSINESS_PROMPT";

// 사업자 미인증 회원에게 안내 알람을 자동 생성 (중복 방지).
async function ensureBusinessPromptForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isBusinessApproved: true },
  });
  if (!user || user.isBusinessApproved) return;

  // 이미 같은 type 의 미읽음 알람 있으면 skip
  const existing = await prisma.notification.findFirst({
    where: { userId, type: BUSINESS_PROMPT_TYPE, isRead: false },
    select: { id: true },
  });
  if (existing) return;

  await prisma.notification.create({
    data: {
      userId,
      type: BUSINESS_PROMPT_TYPE,
      title: "사업자회원으로 전환하면 더 많은 기능을 쓸 수 있어요",
      body: "사업자등록증을 등록하고 관리자 승인을 받으면 상위·하위법인 검색에 우선 노출되고, 통계제출처 자동 라우팅 등 사업자 전용 기능을 이용할 수 있어요. 마이페이지에서 사업자 정보를 등록해주세요.",
      link: "/mypage",
    },
  });
}

export async function GET(_req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  // 사업자 미인증 자동 안내
  await ensureBusinessPromptForUser(user.id).catch(() => undefined);

  const [list, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
      take: 30,
      select: { id: true, type: true, title: true, body: true, link: true, isRead: true, createdAt: true },
    }),
    prisma.notification.count({ where: { userId: user.id, isRead: false } }),
  ]);

  return NextResponse.json({ list, unreadCount });
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  let body: { id?: string; isRead?: boolean; allRead?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  if (body.allRead === true) {
    const r = await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    return NextResponse.json({ success: true, updated: r.count });
  }

  if (!body.id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const existing = await prisma.notification.findUnique({
    where: { id: body.id },
    select: { userId: true },
  });
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  await prisma.notification.update({
    where: { id: body.id },
    data: { isRead: body.isRead ?? true },
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const existing = await prisma.notification.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!existing || existing.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  await prisma.notification.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
