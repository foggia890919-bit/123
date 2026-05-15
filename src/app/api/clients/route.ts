import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";
import { normalizeCompanyName } from "@/lib/company-name";

// GET /api/clients?q=...&bizNumber=...  전역 거래처 검색
export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const bizNumber = req.nextUrl.searchParams.get("bizNumber");
  if (bizNumber) {
    const normalized = bizNumber.replace(/\D/g, "");
    const client = await prisma.client.findUnique({
      where: { bizNumber: normalized },
      select: { id: true, clientName: true, bizNumber: true, bizFileName: true },
    });
    return NextResponse.json({ found: !!client, client: client ?? null });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const isDigits = /^\d+$/.test(q.replace(/-/g, ""));
  const nameOrBizWhere = q
    ? isDigits
      ? { bizNumber: { contains: q.replace(/\D/g, "") } }
      : { clientName: { contains: q, mode: "insensitive" as const } }
    : {};

  const [globalClients, userClients] = await Promise.all([
    prisma.client.findMany({
      where: nameOrBizWhere,
      select: { id: true, clientName: true, bizNumber: true, bizFileName: true },
      orderBy: { clientName: "asc" },
      take: 30,
    }),
    prisma.userClient.findMany({
      where: { userId: user.id, dealerType: null, ...nameOrBizWhere },
      select: { id: true, clientName: true, bizNumber: true, bizFileName: true },
      orderBy: { clientName: "asc" },
      take: 30,
    }).catch(() => prisma.userClient.findMany({
      where: { userId: user.id, ...nameOrBizWhere },
      select: { id: true, clientName: true, bizNumber: true, bizFileName: true },
      orderBy: { clientName: "asc" },
      take: 30,
    })),
  ]);

  const seen = new Set<string>();
  const merged: { id: string; clientName: string; bizNumber: string; bizFileName: string | null }[] = [];
  for (const c of [...globalClients, ...userClients]) {
    const key = c.bizNumber.replace(/\D/g, "");
    if (!seen.has(key)) { seen.add(key); merged.push(c); }
  }
  return NextResponse.json(merged.sort((a, b) => a.clientName.localeCompare(b.clientName)).slice(0, 30));
}

// POST /api/clients  — 새 전역 거래처 등록
export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const {
    clientName, bizNumber,
    bizDocument, bizFileName,
    csoDocument, csoFileName,
    accountDocument, accountFileName,
  } = await req.json();

  if (!clientName || !bizNumber) {
    return NextResponse.json({ error: "거래처명과 사업자번호는 필수입니다." }, { status: 400 });
  }

  const normalizedName = normalizeCompanyName(String(clientName).trim());
  const normalized = String(bizNumber).replace(/\D/g, "");

  const [
    { fileKey: bizFileKey, fileData: bizDocFallback },
    { fileKey: csoFileKey },
    { fileKey: accountFileKey },
  ] = await Promise.all([
    persistDataUri(BUCKETS.userClientBiz, `global/${normalized}/biz`, bizDocument ?? null),
    persistDataUri(BUCKETS.userClientBiz, `global/${normalized}/cso`, csoDocument ?? null),
    persistDataUri(BUCKETS.userClientBiz, `global/${normalized}/account`, accountDocument ?? null),
  ]);

  try {
    const row = await prisma.client.create({
      data: {
        clientName: normalizedName,
        bizNumber: normalized,
        bizDocument: bizDocFallback,
        bizFileKey: bizFileKey ?? null,
        bizFileName: bizFileName ?? null,
        csoFileKey: csoFileKey ?? null,
        csoFileName: csoFileName ?? null,
        accountFileKey: accountFileKey ?? null,
        accountFileName: accountFileName ?? null,
        createdByUserId: user.id,
      },
      select: { id: true, clientName: true, bizNumber: true, bizFileName: true },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "이미 등록된 사업자번호예요." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/clients?id=xxx  (관리자 전용)
export async function DELETE(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
  await prisma.client.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
