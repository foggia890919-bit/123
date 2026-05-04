import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { encryptSecret } from "@/lib/crypto-secret";

function bizOrAdmin(role: string) { return role === "BIZ" || role === "ADMIN"; }

const PUBLIC_SELECT = {
  id: true, bizNumber: true, clientName: true, loginId: true, active: true,
  lastSyncedAt: true, lastSyncStatus: true, lastSyncError: true, memo: true,
  createdAt: true, updatedAt: true,
  assignedSalesRepUserId: true,
  assignedSalesRep: { select: { id: true, name: true, email: true } },
} as const;

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const rows = await prisma.epharmsAccount.findMany({
    where: q ? { OR: [
      { clientName: { contains: q, mode: "insensitive" } },
      { bizNumber:  { contains: q } },
      { loginId:    { contains: q, mode: "insensitive" } },
    ] } : {},
    select: PUBLIC_SELECT,
    orderBy: [{ active: "desc" }, { clientName: "asc" }],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { bizNumber, clientName, loginId, loginPw, memo, assignedSalesRepUserId } = await req.json();
  if (!bizNumber || !clientName || !loginId || !loginPw) {
    return NextResponse.json({ error: "사업자번호, 거래처명, 로그인ID, 로그인PW는 필수입니다." }, { status: 400 });
  }
  const enc = encryptSecret(String(loginPw));
  const row = await prisma.epharmsAccount.upsert({
    where: { bizNumber: String(bizNumber) },
    create: {
      bizNumber: String(bizNumber), clientName: String(clientName),
      loginId: String(loginId), loginPwEnc: enc, memo: memo || null,
      assignedSalesRepUserId: assignedSalesRepUserId || null,
    },
    update: {
      clientName: String(clientName), loginId: String(loginId), loginPwEnc: enc,
      memo: memo || null, active: true,
      assignedSalesRepUserId: assignedSalesRepUserId || null,
    },
    select: PUBLIC_SELECT,
  });
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id, clientName, loginId, loginPw, memo, active, assignedSalesRepUserId } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });
  const data: Record<string, unknown> = {};
  if (clientName !== undefined) data.clientName = clientName;
  if (loginId !== undefined) data.loginId = loginId;
  if (memo !== undefined) data.memo = memo || null;
  if (active !== undefined) data.active = !!active;
  if (loginPw) data.loginPwEnc = encryptSecret(String(loginPw));
  if (assignedSalesRepUserId !== undefined) data.assignedSalesRepUserId = assignedSalesRepUserId || null;
  const row = await prisma.epharmsAccount.update({ where: { id }, data, select: PUBLIC_SELECT });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });
  await prisma.epharmsAccount.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
