// ePharms 거래처별 로그인 계정 CRUD.
// PW는 절대 평문 응답하지 않음 — 등록/수정 요청 시에만 받아 즉시 암호화 저장.
//
// GET ?own=true       → 영업사원 본인 담당 원내거래처만 반환 (SALES_REP 포함 모든 역할)
// GET (BIZ/ADMIN)     → 전체 목록 (페이지네이션)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, safeParseInt } from "@/lib/auth-guard";
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
  salesRepId: true,
  salesRep: { select: { id: true, email: true, name: true, salesCode: true } },
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const own = req.nextUrl.searchParams.get("own") === "true";

  // 영업사원이 본인 담당 원내거래처 조회 (원내주문 화면용)
  if (own || (!bizOrAdmin(user.role) && user.role === "SALES_REP")) {
    const rows = await prisma.epharmsAccount.findMany({
      where: { salesRepId: user.id, active: true },
      select: ROW_SELECT,
      orderBy: { clientName: "asc" },
    });
    return NextResponse.json({ items: rows, total: rows.length });
  }

  if (!bizOrAdmin(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const page = safeParseInt(req.nextUrl.searchParams.get("page"), 1, 1, 10000);
  const limit = safeParseInt(req.nextUrl.searchParams.get("limit"), 50, 1, 200);
  const skip = (page - 1) * limit;

  const where = q
    ? {
        OR: [
          { clientName: { contains: q, mode: "insensitive" as const } },
          { bizNumber: { contains: q } },
          { loginId: { contains: q, mode: "insensitive" as const } },
          { kmdUser: { email: { contains: q, mode: "insensitive" as const } } },
          { kmdUser: { name: { contains: q, mode: "insensitive" as const } } },
          { salesRep: { name: { contains: q, mode: "insensitive" as const } } },
          { salesRep: { salesCode: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    prisma.epharmsAccount.findMany({
      where,
      select: ROW_SELECT,
      orderBy: [{ active: "desc" }, { clientName: "asc" }],
      skip,
      take: limit,
    }),
    prisma.epharmsAccount.count({ where }),
  ]);

  return NextResponse.json({ items: rows, total, page, limit });
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { bizNumber, clientName, loginId, loginPw, memo, kmdUserId, salesRepId } = await req.json();
  if (!bizNumber || !clientName || !loginId || !loginPw) {
    return NextResponse.json(
      { error: "사업자번호, 거래처명, 로그인ID, 로그인PW는 필수입니다." },
      { status: 400 }
    );
  }

  let resolvedKmdUserId: string | null = null;
  if (kmdUserId) {
    const exists = await prisma.user.findUnique({ where: { id: String(kmdUserId) }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "선택한 KMD 사용자를 찾을 수 없습니다." }, { status: 400 });
    resolvedKmdUserId = exists.id;
  }

  let resolvedSalesRepId: string | null = null;
  if (salesRepId) {
    const exists = await prisma.user.findUnique({ where: { id: String(salesRepId) }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "선택한 담당자를 찾을 수 없습니다." }, { status: 400 });
    resolvedSalesRepId = exists.id;
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
      salesRepId: resolvedSalesRepId,
    },
    update: {
      clientName: String(clientName),
      loginId: String(loginId),
      loginPwEnc: enc,
      memo: memo || null,
      active: true,
      ...(kmdUserId !== undefined ? { kmdUserId: resolvedKmdUserId } : {}),
      ...(salesRepId !== undefined ? { salesRepId: resolvedSalesRepId } : {}),
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

  const { id, clientName, loginId, loginPw, memo, active, kmdUserId, salesRepId } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (clientName !== undefined) data.clientName = clientName;
  if (loginId !== undefined) data.loginId = loginId;
  if (memo !== undefined) data.memo = memo || null;
  if (active !== undefined) data.active = !!active;
  if (loginPw) data.loginPwEnc = encryptSecret(String(loginPw));
  if (kmdUserId !== undefined) {
    if (!kmdUserId) {
      data.kmdUserId = null;
    } else {
      const exists = await prisma.user.findUnique({ where: { id: String(kmdUserId) }, select: { id: true } });
      if (!exists) return NextResponse.json({ error: "선택한 KMD 사용자를 찾을 수 없습니다." }, { status: 400 });
      data.kmdUserId = exists.id;
    }
  }
  if (salesRepId !== undefined) {
    if (!salesRepId) {
      data.salesRepId = null;
    } else {
      const exists = await prisma.user.findUnique({ where: { id: String(salesRepId) }, select: { id: true } });
      if (!exists) return NextResponse.json({ error: "선택한 담당자를 찾을 수 없습니다." }, { status: 400 });
      data.salesRepId = exists.id;
    }
  }

  const row = await prisma.epharmsAccount.update({ where: { id }, data, select: ROW_SELECT });
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
