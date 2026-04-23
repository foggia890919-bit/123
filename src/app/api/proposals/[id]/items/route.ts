import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

async function assertOwnsProposal(proposalId: string, userId: string, role: string) {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { userId: true } });
  if (!proposal) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (role !== "ADMIN" && proposal.userId !== userId) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { id: proposalId } = await params;
  const fail = await assertOwnsProposal(proposalId, user.id, user.role);
  if (fail) return fail;
  const { medicationId } = await req.json();
  if (!medicationId) return NextResponse.json({ error: "medicationId 필요" }, { status: 400 });

  const exists = await prisma.proposalItem.findFirst({ where: { proposalId, altMedicationId: medicationId } });
  if (exists) return NextResponse.json({ error: "already_exists" }, { status: 409 });

  const count = await prisma.proposalItem.count({ where: { proposalId } });
  const item = await prisma.proposalItem.create({
    data: { proposalId, altMedicationId: medicationId, order: count },
    include: { altMedication: true, originalMedication: true },
  });
  await prisma.proposal.update({ where: { id: proposalId }, data: { updatedAt: new Date() } });
  return NextResponse.json(item);
}

// 기존 항목을 대체품으로 교체 (original은 취소선으로 표시됨)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { id: proposalId } = await params;
  const fail = await assertOwnsProposal(proposalId, user.id, user.role);
  if (fail) return fail;
  const { itemId, newMedicationId } = await req.json();
  if (!itemId || !newMedicationId) return NextResponse.json({ error: "itemId/newMedicationId 필요" }, { status: 400 });

  const target = await prisma.proposalItem.findUnique({ where: { id: itemId } });
  if (!target || target.proposalId !== proposalId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (target.altMedicationId === newMedicationId) {
    return NextResponse.json({ error: "same_medication" }, { status: 400 });
  }

  const duplicate = await prisma.proposalItem.findFirst({
    where: { proposalId, altMedicationId: newMedicationId, NOT: { id: itemId } },
  });
  if (duplicate) return NextResponse.json({ error: "already_exists" }, { status: 409 });

  const item = await prisma.proposalItem.update({
    where: { id: itemId },
    data: {
      originalMedicationId: target.originalMedicationId ?? target.altMedicationId,
      altMedicationId: newMedicationId,
    },
    include: { altMedication: true, originalMedication: true },
  });
  await prisma.proposal.update({ where: { id: proposalId }, data: { updatedAt: new Date() } });
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { id: proposalId } = await params;
  const fail = await assertOwnsProposal(proposalId, user.id, user.role);
  if (fail) return fail;
  const { itemId } = await req.json();
  await prisma.proposalItem.delete({ where: { id: itemId, proposalId } });
  return NextResponse.json({ ok: true });
}
