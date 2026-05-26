import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUrl, BUCKETS } from "@/lib/storage";

export async function GET() {
  try {
    const boards = await prisma.board.findMany({
      where: { active: true },
      orderBy: { order: "asc" },
      include: {
        posts: {
          orderBy: { createdAt: "desc" },
          take: 6,
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });
    return NextResponse.json(
      boards.map((b) => ({
        ...b,
        posts: b.posts.map((p) => ({
          ...p,
          imageUrls: p.images.map((k) => publicUrl(BUCKETS.postImage, k)),
        })),
      }))
    );
  } catch (err) {
    console.error("[boards-home GET]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
