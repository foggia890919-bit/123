import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { publicUrl, BUCKETS } from "@/lib/storage";

type Params = { params: Promise<{ slug: string; id: string }> };

function withImageUrls(post: { images: string[]; [k: string]: unknown }) {
  return { ...post, imageUrls: post.images.map((k) => publicUrl(BUCKETS.postImage, k)) };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const post = await prisma.post.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true } }, board: { select: { slug: true, name: true, type: true } } },
  });
  if (!post) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // increment views (fire-and-forget)
  prisma.post.update({ where: { id }, data: { views: { increment: 1 } } }).catch(() => null);
  return NextResponse.json(withImageUrls(post));
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { id } = await params;
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (u.role !== "ADMIN" && post.userId !== u.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { title, content, images } = await req.json();
  const updated = await prisma.post.update({
    where: { id },
    data: {
      ...(title !== undefined && { title: title.trim() }),
      ...(content !== undefined && { content: content?.trim() || null }),
      ...(images !== undefined && { images: Array.isArray(images) ? images : [] }),
    },
    include: { user: { select: { id: true, name: true } } },
  });
  return NextResponse.json(withImageUrls(updated));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { id } = await params;
  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (u.role !== "ADMIN" && post.userId !== u.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  await prisma.post.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
