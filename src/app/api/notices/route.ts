import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const notices = await prisma.notice.findMany({
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
      take: 20,
    });
    return NextResponse.json(notices);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }
  const { title, content, category, isPinned } = await req.json();
  if (!title?.trim() || !content?.trim()) {
    return NextResponse.json({ error: "제목과 내용을 입력하세요" }, { status: 400 });
  }
  const notice = await prisma.notice.create({
    data: { title: title.trim(), content: content.trim(), category: category || "공지", isPinned: !!isPinned },
  });
  return NextResponse.json(notice);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }
  const { id } = await req.json();
  await prisma.notice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
