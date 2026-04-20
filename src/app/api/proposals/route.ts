import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { title, userId, clientId } = await req.json();
    if (!title || !userId) return NextResponse.json({ error: "필수 항목 없음" }, { status: 400 });
    const proposal = await prisma.proposal.create({
      data: { title, userId, clientId: clientId || null },
      include: { client: { select: { id: true, clientName: true, bizNumber: true, approved: true } } },
    });
    return NextResponse.json(proposal);
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
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
