import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  try {
    const { title, clientId } = await req.json();
    if (!title) return NextResponse.json({ error: "제목 필수" }, { status: 400 });
    try {
      const proposal = await prisma.proposal.create({
        data: { title, userId: user.id, clientId: clientId || null },
        include: { client: { select: { id: true, clientName: true, bizNumber: true, approved: true } } },
      });
      return NextResponse.json(proposal);
    } catch {
      const proposal = await prisma.proposal.create({ data: { title, userId: user.id } });
      return NextResponse.json(proposal);
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET() {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  try {
    const proposals = await prisma.proposal.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { items: true } },
        client: { select: { id: true, clientName: true, bizNumber: true, approved: true } },
      },
    });
    return NextResponse.json(proposals);
  } catch {
    try {
      const proposals = await prisma.proposal.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { items: true } } },
      });
      return NextResponse.json(proposals);
    } catch (e2) {
      return NextResponse.json({ error: String(e2) }, { status: 500 });
    }
  }
}
