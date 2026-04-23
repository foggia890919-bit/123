import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUrl, BUCKETS } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const board = await prisma.board.findUnique({
    where: { slug, active: true },
    include: {
      _count: { select: { posts: true } },
      posts: {
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });
  if (!board) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({
    ...board,
    posts: board.posts.map((p) => ({
      ...p,
      imageUrls: p.images.map((k) => publicUrl(BUCKETS.postImage, k)),
    })),
  });
}
