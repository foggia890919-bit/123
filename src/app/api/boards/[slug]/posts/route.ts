import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { safeParseInt } from "@/lib/auth-guard";
import { publicUrl, BUCKETS } from "@/lib/storage";

function withImageUrls(post: { images: string[]; [k: string]: unknown }) {
  return {
    ...post,
    imageUrls: post.images.map((k) => publicUrl(BUCKETS.postImage, k)),
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { searchParams } = new URL(req.url);
  const page = safeParseInt(searchParams.get("page"), 1, 1);
  const limit = safeParseInt(searchParams.get("limit"), 20, 1, 50);

  const board = await prisma.board.findUnique({ where: { slug, active: true } });
  if (!board) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where: { boardId: board.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.post.count({ where: { boardId: board.id } }),
  ]);

  return NextResponse.json({ board, posts: posts.map(withImageUrls), total, page, limit });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { slug } = await params;
  const board = await prisma.board.findUnique({ where: { slug, active: true } });
  if (!board) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // ADMIN can always post; others must be registered as editor for this board
  if (u.role !== "ADMIN") {
    const isEditor = await prisma.boardEditor.findUnique({
      where: { boardId_userId: { boardId: board.id, userId: u.id } },
    });
    if (!isEditor) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { title, content, images } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: "제목 필수" }, { status: 400 });

  const post = await prisma.post.create({
    data: {
      boardId: board.id,
      userId: u.id,
      title: title.trim(),
      content: content?.trim() || null,
      images: Array.isArray(images) ? images : [],
    },
    include: { user: { select: { id: true, name: true } } },
  });

  return NextResponse.json(withImageUrls(post));
}
