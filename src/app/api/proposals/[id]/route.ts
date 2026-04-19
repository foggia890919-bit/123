import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompanyKey } from "@/lib/utils";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    include: {
      items: { include: { altMedication: true }, orderBy: { order: "asc" } },
      client: { select: { id: true, clientName: true, bizNumber: true, approved: true } },
    },
  });
  if (!proposal) return NextResponse.json({ error: "없음" }, { status: 404 });

  const rateMap: Record<string, number> = {};
  const rates = await prisma.memberCompanyRate.findMany({ where: { userId: proposal.userId } });
  for (const r of rates) rateMap[normalizeCompanyKey(r.companyName)] = r.additionalRate;

  const items = proposal.items.map((item) => ({
    ...item,
    altMedication: item.altMedication
      ? { ...item.altMedication, additionalRate: rateMap[normalizeCompanyKey(item.altMedication.companyName)] ?? null }
      : null,
  }));

  return NextResponse.json({ ...proposal, items });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.proposal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { title, clientId } = await req.json();
  const data: { title?: string; clientId?: string | null; updatedAt: Date } = { updatedAt: new Date() };
  if (title !== undefined) data.title = title;
  if (clientId !== undefined) data.clientId = clientId || null;
  const proposal = await prisma.proposal.update({ where: { id }, data });
  return NextResponse.json(proposal);
}
