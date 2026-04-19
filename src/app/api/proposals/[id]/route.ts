import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    include: {
      items: {
        include: { altMedication: true },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!proposal) return NextResponse.json({ error: "없음" }, { status: 404 });
  return NextResponse.json(proposal);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.proposal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { title } = await req.json();
  const proposal = await prisma.proposal.update({ where: { id }, data: { title, updatedAt: new Date() } });
  return NextResponse.json(proposal);
}
