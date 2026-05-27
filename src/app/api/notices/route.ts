import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    // ?popup=1 returns only active popup notices
    if (searchParams.get("popup") === "1") {
      const now = new Date();
      const notices = await prisma.notice.findMany({
        where: {
          showAsPopup: true,
          OR: [{ popupUntil: null }, { popupUntil: { gte: now } }],
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      return NextResponse.json(notices);
    }
    const notices = await prisma.notice.findMany({
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      take: 20,
    });
    return NextResponse.json(notices);
  } catch (err) {
    console.error("[notices GET]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { title, content, category, isPinned, showAsPopup, popupUntil } = await req.json();
  if (!title?.trim() || !content?.trim()) {
    return NextResponse.json({ error: "제목과 내용을 입력하세요" }, { status: 400 });
  }
  const notice = await prisma.notice.create({
    data: {
      title: title.trim(),
      content: content.trim(),
      category: category || "공지",
      isPinned: !!isPinned,
      showAsPopup: !!showAsPopup,
      popupUntil: popupUntil ? new Date(popupUntil) : null,
    },
  });
  return NextResponse.json(notice);
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });
  await prisma.notice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
