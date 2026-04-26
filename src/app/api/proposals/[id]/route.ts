import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompanyKey } from "@/lib/utils";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

async function loadOwned(id: string, userId: string, role: string) {
  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (!proposal) return { error: "NOT_FOUND" as const };
  if (role !== "ADMIN" && proposal.userId !== userId) return { error: "FORBIDDEN" as const };
  return { proposal };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { id } = await params;
  const owned = await loadOwned(id, user.id, user.role);
  if ("error" in owned) {
    return NextResponse.json({ error: owned.error }, { status: owned.error === "NOT_FOUND" ? 404 : 403 });
  }
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    include: {
      items: { include: { altMedication: true, originalMedication: true }, orderBy: { order: "asc" } },
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
    originalMedication: item.originalMedication
      ? { ...item.originalMedication, additionalRate: rateMap[normalizeCompanyKey(item.originalMedication.companyName)] ?? null }
      : null,
  }));

  return NextResponse.json({ ...proposal, items });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { id } = await params;
  const owned = await loadOwned(id, user.id, user.role);
  if ("error" in owned) {
    return NextResponse.json({ error: owned.error }, { status: owned.error === "NOT_FOUND" ? 404 : 403 });
  }
  await prisma.proposal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { id } = await params;
  const owned = await loadOwned(id, user.id, user.role);
  if ("error" in owned) {
    return NextResponse.json({ error: owned.error }, { status: owned.error === "NOT_FOUND" ? 404 : 403 });
  }
  const { title, clientId } = await req.json();
  const data: { title?: string; clientId?: string | null; updatedAt: Date } = { updatedAt: new Date() };
  if (title !== undefined) data.title = title;
  if (clientId !== undefined) data.clientId = clientId || null;
  try {
    const proposal = await prisma.proposal.update({ where: { id }, data });
    return NextResponse.json(proposal);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
