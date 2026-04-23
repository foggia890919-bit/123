import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

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
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
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
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });
  await prisma.notice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
