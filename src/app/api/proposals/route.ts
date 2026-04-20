import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { title, userId, clientId } = await req.json();
    if (!title || !userId) return NextResponse.json({ error: "필수 항목 없음" }, { status: 400 });
    try {
      const proposal = await prisma.proposal.create({
        data: { title, userId, clientId: clientId || null },
        include: { client: { select: { id: true, clientName: true, bizNumber: true, approved: true } } },
      });
      return NextResponse.json(proposal);
    } catch {
      // clientId 컬럼 없는 경우 거래처 없이 생성
      const proposal = await prisma.proposal.create({ data: { title, userId } });
      return NextResponse.json(proposal);
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId 필요" }, { status: 400 });
  try {
    const proposals = await prisma.proposal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { items: true } },
        client: { select: { id: true, clientName: true, bizNumber: true, approved: true } },
      },
    });
    return NextResponse.json(proposals);
  } catch {
    // clientId 컬럼 없는 경우(마이그레이션 전) 기존 제안서라도 반환
    try {
      const proposals = await prisma.proposal.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { items: true } } },
      });
      return NextResponse.json(proposals);
    } catch (e2) {
      return NextResponse.json({ error: String(e2) }, { status: 500 });
    }
  }
}
