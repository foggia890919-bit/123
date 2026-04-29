import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export const runtime = "nodejs";

// GET /api/user-clients/[id] → 거래처 상세 + 연결된 항목 카운트
// DELETE /api/user-clients/[id] → 거래처 삭제 (연결된 보고서/제안서는 SetNull로 유지)
//
// 본인 거래처만 삭제 가능. ADMIN 은 모든 거래처 삭제 가능.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const { id } = await ctx.params;
  const client = await prisma.userClient.findUnique({
    where: { id },
    select: { id: true, userId: true, clientName: true, bizNumber: true, approved: true },
  });
  if (!client) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (user.role !== "ADMIN" && client.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const [reportCount, proposalCount] = await Promise.all([
    prisma.prescriptionReport.count({ where: { clientId: id } }),
    prisma.proposal.count({ where: { clientId: id } }),
  ]);

  return NextResponse.json({ ...client, reportCount, proposalCount });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const { id } = await ctx.params;
  const client = await prisma.userClient.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!client) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (user.role !== "ADMIN" && client.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  await prisma.userClient.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
