import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json([]);

  const history = await prisma.searchHistory.findMany({
    where: { userId: session.user.id },
    orderBy: { searchedAt: "desc" },
    take: 20,
  });
  return NextResponse.json(history);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ ok: false });

  const { query, companies, resultCount } = await req.json();
  if (!query) return NextResponse.json({ ok: false });

  // 동일 쿼리+필터 기존 항목 삭제 후 새로 추가
  await prisma.searchHistory.deleteMany({
    where: { userId: session.user.id, query },
  });
  await prisma.searchHistory.create({
    data: { userId: session.user.id, query, companies: companies ?? [], resultCount: resultCount ?? 0 },
  });

  // 20개 초과 시 오래된 것 삭제
  const all = await prisma.searchHistory.findMany({
    where: { userId: session.user.id },
    orderBy: { searchedAt: "desc" },
    select: { id: true },
  });
  if (all.length > 20) {
    const toDelete = all.slice(20).map((h) => h.id);
    await prisma.searchHistory.deleteMany({ where: { id: { in: toDelete } } });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ ok: false });

  const { id } = await req.json().catch(() => ({}));
  if (id) {
    await prisma.searchHistory.deleteMany({ where: { id, userId: session.user.id } });
  } else {
    // id 없으면 전체 삭제
    await prisma.searchHistory.deleteMany({ where: { userId: session.user.id } });
  }
  return NextResponse.json({ ok: true });
}
