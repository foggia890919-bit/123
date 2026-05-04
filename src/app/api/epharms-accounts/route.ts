// ePharms 거래처별 로그인 계정 CRUD.
// PW는 절대 평문 응답하지 않음 — 등록/수정 요청 시에만 받아 즉시 암호화 저장.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { encryptSecret } from "@/lib/crypto-secret";

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

const ROW_SELECT = {
  id: true,
  bizNumber: true,
  clientName: true,
  loginId: true,
  active: true,
  lastSyncedAt: true,
  lastSyncStatus: true,
  lastSyncError: true,
  memo: true,
  kmdUserId: true,
  kmdUser: { select: { id: true, email: true, name: true } },
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const rows = await prisma.epharmsAccount.findMany({
    where: q
      ? {
          OR: [
            { clientName: { contains: q, mode: "insensitive" } },
            { bizNumber: { contains: q } },
            { loginId: { contains: q, mode: "insensitive" } },
            { kmdUser: { email: { contains: q, mode: "insensitive" } } },
            { kmdUser: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {},
    select: ROW_SELECT,
    orderBy: [{ active: "desc" }, { clientName: "asc" }],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { bizNumber, clientName, loginId, loginPw, memo, kmdUserId } = await req.json();
  if (!bizNumber || !clientName || !loginId || !loginPw) {
    return NextResponse.json(
      { error: "사업자번호, 거래처명, 로그인ID, 로그인PW는 필수입니다." },
      { status: 400 }
    );
  }

  // kmdUserId가 들어오면 실제 존재하는 사용자인지 확인 (FK violation 방지)
  let resolvedKmdUserId: string | null = null;
  if (kmdUserId) {
    const exists = await prisma.user.findUnique({
      where: { id: String(kmdUserId) },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: "선택한 KMD 사용자를 찾을 수 없습니다." }, { status: 400 });
    }
    resolvedKmdUserId = exists.id;
  }

  const enc = encryptSecret(String(loginPw));
  const row = await prisma.epharmsAccount.upsert({
    where: { bizNumber: String(bizNumber) },
    create: {
      bizNumber: String(bizNumber),
      clientName: String(clientName),
      loginId: String(loginId),
      loginPwEnc: enc,
      memo: memo || null,
      kmdUserId: resolvedKmdUserId,
    },
    update: {
      clientName: String(clientName),
      loginId: String(loginId),
      loginPwEnc: enc,
      memo: memo || null,
      active: true,
      ...(kmdUserId !== undefined ? { kmdUserId: resolvedKmdUserId } : {}),
    },
    select: ROW_SELECT,
  });
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id, clientName, loginId, loginPw, memo, active, kmdUserId } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (clientName !== undefined) data.clientName = clientName;
  if (loginId !== undefined) data.loginId = loginId;
  if (memo !== undefined) data.memo = memo || null;
  if (active !== undefined) data.active = !!active;
  if (loginPw) data.loginPwEnc = encryptSecret(String(loginPw)); // PW는 입력했을 때만 갱신
  if (kmdUserId !== undefined) {
    if (kmdUserId === null || kmdUserId === "") {
      data.kmdUserId = null;
    } else {
      const exists = await prisma.user.findUnique({
        where: { id: String(kmdUserId) },
        select: { id: true },
      });
      if (!exists) {
        return NextResponse.json({ error: "선택한 KMD 사용자를 찾을 수 없습니다." }, { status: 400 });
      }
      data.kmdUserId = exists.id;
    }
  }

  const row = await prisma.epharmsAccount.update({
    where: { id },
    data,
    select: ROW_SELECT,
  });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });
  await prisma.epharmsAccount.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
