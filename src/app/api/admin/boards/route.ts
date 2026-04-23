import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const boards = await prisma.board.findMany({
    orderBy: { order: "asc" },
    include: { _count: { select: { posts: true, editors: true } } },
  });
  return NextResponse.json(boards);
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { name, slug, description, type, order, active } = await req.json();
  if (!name?.trim() || !slug?.trim()) return NextResponse.json({ error: "이름과 슬러그 필수" }, { status: 400 });
  const safeSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const board = await prisma.board.create({
    data: {
      name: name.trim(),
      slug: safeSlug,
      description: description?.trim() || null,
      type: type || "MIXED",
      order: typeof order === "number" ? order : 0,
      active: active !== false,
    },
  });
  return NextResponse.json(board);
}
