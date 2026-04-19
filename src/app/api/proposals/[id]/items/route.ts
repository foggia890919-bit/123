import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: proposalId } = await params;
  const { medicationId } = await req.json();
  if (!medicationId) return NextResponse.json({ error: "medicationId 필요" }, { status: 400 });

  const exists = await prisma.proposalItem.findFirst({ where: { proposalId, altMedicationId: medicationId } });
  if (exists) return NextResponse.json({ error: "already_exists" }, { status: 409 });

  const count = await prisma.proposalItem.count({ where: { proposalId } });
  const item = await prisma.proposalItem.create({
    data: { proposalId, altMedicationId: medicationId, order: count },
    include: { altMedication: true },
  });
  await prisma.proposal.update({ where: { id: proposalId }, data: { updatedAt: new Date() } });
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: proposalId } = await params;
  const { itemId } = await req.json();
  await prisma.proposalItem.delete({ where: { id: itemId, proposalId } });
  return NextResponse.json({ ok: true });
}
