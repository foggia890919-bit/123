import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { id: proposalId } = await params;

  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { userId: true } });
  if (!proposal) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (user.role !== "ADMIN" && proposal.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { codes } = await req.json() as { codes: string[] };

  if (!Array.isArray(codes) || codes.length === 0) {
    return NextResponse.json({ error: "코드 목록이 비어있습니다" }, { status: 400 });
  }
  if (codes.length > 2000) {
    return NextResponse.json({ error: "한 번에 2000개까지만 처리할 수 있어요." }, { status: 400 });
  }

  const matched: string[] = [];
  const unmatched: string[] = [];
  let added = 0;

  for (const raw of codes) {
    const code = String(raw).trim();
    if (!code) continue;

    // 보험코드로 약품 조회
    const med = await prisma.medication.findFirst({
      where: { insuranceCode: code },
      select: { id: true },
    });

    if (med) {
      // 이미 있으면 스킵
      const exists = await prisma.proposalItem.findFirst({
        where: { proposalId, altMedicationId: med.id },
      });
      if (!exists) {
        const count = await prisma.proposalItem.count({ where: { proposalId } });
        await prisma.proposalItem.create({
          data: { proposalId, altMedicationId: med.id, order: count },
        });
        matched.push(code);
        added++;
      }
    } else {
      // 미인식 코드: note 필드에 저장, altMedicationId = null
      const exists = await prisma.proposalItem.findFirst({
        where: { proposalId, altMedicationId: null, note: code },
      });
      if (!exists) {
        const count = await prisma.proposalItem.count({ where: { proposalId } });
        await prisma.proposalItem.create({
          data: { proposalId, altMedicationId: null, note: code, order: count },
        });
        unmatched.push(code);
        added++;
      }
    }
  }

  await prisma.proposal.update({ where: { id: proposalId }, data: { updatedAt: new Date() } });

  return NextResponse.json({ added, matched, unmatched });
}
