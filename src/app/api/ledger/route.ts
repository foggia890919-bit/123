// 영업사원/거래처가 본인이 담당하는 거래처들의 매출원장을 조회.
//
//   GET /api/ledger
//     → 현재 로그인 사용자가 볼 수 있는 거래처 목록 + 각 거래처의 최근 매출원장 메타
//
//   GET /api/ledger?bizNumber=2110948285&from=2025-01-01&to=2025-12-31
//     → 특정 거래처의 명세 줄들 (권한 체크: 아래 권한 규칙)
//
// 권한:
//   - ADMIN/BIZ        : 모든 거래처 조회 가능
//   - 그 외 (SALES_REP / PHARMACIST / BASIC ...):
//       (a) 본인의 UserClient(approved=true) bizNumber 매칭, 또는
//       (b) EpharmsAccount.kmdUserId === 본인 User.id (KMD 계정 직접 매핑)
//     둘 중 하나라도 만족하면 조회 가능.

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
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

  // 1) 비-관리자: 접근 가능한 EpharmsAccount where 절 만들기
  //    bizNumber in [내 거래처들] OR kmdUserId === user.id
  let scopedWhere: Prisma.EpharmsAccountWhereInput | null = null; // null = 전체 허용
  if (!isAdminLike(user.role)) {
    const myClients = await prisma.userClient.findMany({
      where: { userId: user.id, approved: true },
      select: { bizNumber: true },
    });
    const allowedBizNumbers = myClients.map((c) => c.bizNumber);
    scopedWhere = {
      OR: [
        ...(allowedBizNumbers.length > 0 ? [{ bizNumber: { in: allowedBizNumbers } }] : []),
        { kmdUserId: user.id },
      ],
    };
  }

  // ===== 단일 거래처 상세 조회 =====
  if (bizNumber) {
    const acc = await prisma.epharmsAccount.findUnique({
      where: { bizNumber },
      select: {
        id: true, bizNumber: true, clientName: true,
        active: true, lastSyncedAt: true, lastSyncStatus: true,
        kmdUserId: true,
      },
    });
    if (!acc) {
      return NextResponse.json({ account: null, entries: [] });
    }

    // 권한: ADMIN/BIZ는 무조건 통과, 그 외는 (UserClient bizNumber 매칭) OR (kmdUserId 일치)
    if (!isAdminLike(user.role)) {
      const myClient = await prisma.userClient.findFirst({
        where: { userId: user.id, approved: true, bizNumber },
        select: { id: true },
      });
      const ok = !!myClient || acc.kmdUserId === user.id;
      if (!ok) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
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
  const where: Prisma.EpharmsAccountWhereInput = scopedWhere ?? {};

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
