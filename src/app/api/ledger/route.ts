// 영업사원/거래처가 본인이 담당하는 거래처들의 매출원장을 조회.
//
//   GET /api/ledger
//     → 현재 로그인 사용자가 볼 수 있는 거래처 목록 + 각 거래처의 최근 매출원장 메타
//
//   GET /api/ledger?bizNumber=2110948285&from=2025-01-01&to=2025-12-31
//     → 특정 거래처의 명세 줄들 (권한 체크: UserClient에 등록된 거래처만)
//
// 권한:
//   - ADMIN/BIZ        : 모든 거래처 조회 가능
//   - SALES_REP        : 본인의 UserClient(approved=true)에 등록된 거래처만

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

function isAdminLike(role: string) {
  return role === "ADMIN" || role === "BIZ";
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const bizNumber = req.nextUrl.searchParams.get("bizNumber");
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  // 1) 사용자가 접근 가능한 사업자번호 화이트리스트 만들기
  let allowedBizNumbers: string[] | null = null; // null = 전체 허용
  if (!isAdminLike(user.role)) {
    const myClients = await prisma.userClient.findMany({
      where: { userId: user.id, approved: true },
      select: { bizNumber: true },
    });
    allowedBizNumbers = myClients.map((c) => c.bizNumber);
  }

  // ===== 단일 거래처 상세 조회 =====
  if (bizNumber) {
    if (allowedBizNumbers !== null && !allowedBizNumbers.includes(bizNumber)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    const acc = await prisma.epharmsAccount.findUnique({
      where: { bizNumber },
      select: {
        id: true, bizNumber: true, clientName: true,
        active: true, lastSyncedAt: true, lastSyncStatus: true,
      },
    });
    if (!acc) {
      return NextResponse.json({ account: null, entries: [] });
    }
    const entries = await prisma.ledgerEntry.findMany({
      where: {
        accountId: acc.id,
        ...(from || to
          ? {
              entryDate: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { entryDate: "asc" },
      select: {
        id: true, entryDate: true, itemName: true,
        sales: true, payment: true, balance: true,
      },
    });
    return NextResponse.json({ account: acc, entries });
  }

  // ===== 거래처 목록 + 최근 매출원장 메타 =====
  const where = allowedBizNumbers === null
    ? {}
    : { bizNumber: { in: allowedBizNumbers } };

  const accounts = await prisma.epharmsAccount.findMany({
    where,
    select: {
      id: true, bizNumber: true, clientName: true, active: true,
      lastSyncedAt: true, lastSyncStatus: true,
      _count: { select: { ledgerEntries: true } },
    },
    orderBy: { clientName: "asc" },
  });

  // 각 계정의 최근 잔액 1건 (대시보드 카드용)
  const latest = await Promise.all(
    accounts.map(async (a) => {
      const last = await prisma.ledgerEntry.findFirst({
        where: { accountId: a.id },
        orderBy: { entryDate: "desc" },
        select: { entryDate: true, balance: true },
      });
      return { ...a, latestEntry: last };
    })
  );

  return NextResponse.json({ accounts: latest });
}
