import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { requireSession, requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const all = req.nextUrl.searchParams.get("all") === "true";
  // Exclude heavy bizDocument from list responses — download via /api/files/filter-request/[id]
  const select = {
    id: true, userId: true, userName: true, clientName: true, bizNumber: true,
    bizFileName: true, bizFileKey: true, companyName: true, status: true,
    replyText: true, repliedAt: true, createdAt: true, updatedAt: true,
  } as const;
  if (all) {
    if (user.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    const requests = await prisma.filterRequest.findMany({
      orderBy: { createdAt: "desc" },
      select: { ...select, user: { select: { name: true, email: true } } },
    });
    return NextResponse.json(requests.map((r) => ({ ...r, bizDocument: null, hasBizDocument: !!r.bizFileName })));
  }
  const requests = await prisma.filterRequest.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { ...select, user: { select: { name: true, email: true } } },
  });
  return NextResponse.json(requests.map((r) => ({ ...r, bizDocument: null, hasBizDocument: !!r.bizFileName })));
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { clientName, bizNumber, bizDocument, bizFileName, companies } = await req.json();

  if (!clientName || !bizNumber || !companies?.length) {
    return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
  }
  if (!Array.isArray(companies) || companies.length > 200) {
    return NextResponse.json({ error: "제약사는 최대 200개까지 선택할 수 있어요." }, { status: 400 });
  }

  // Upload bizDocument once (shared across all rows)
  const { fileKey: bizFileKey, fileData: bizDocumentFallback } =
    await persistDataUri(BUCKETS.filterRequestBiz, user.id, bizDocument);

  await prisma.filterRequest.createMany({
    data: (companies as string[]).map((companyName: string) => ({
      id: crypto.randomUUID(),
      userId: user.id,
      userName: user.name ?? user.email,
      clientName,
      bizNumber,
      bizDocument: bizDocumentFallback,
      bizFileKey,
      bizFileName: bizFileName || null,
      companyName,
      updatedAt: new Date(),
    })),
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { id, status, replyText } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });
  const data: Prisma.FilterRequestUpdateInput = { updatedAt: new Date() };
  if (status !== undefined) data.status = status;
  if (replyText !== undefined) {
    data.replyText = replyText || null;
    data.repliedAt = new Date();
  }
  const updated = await prisma.filterRequest.update({ where: { id }, data });
  return NextResponse.json(updated);
}
