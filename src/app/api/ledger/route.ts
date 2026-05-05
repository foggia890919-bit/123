// 영업사원/거래처가 본인이 담당하는 거래처들의 매출원장을 조회.
//
//   GET /api/ledger
//     → 현재 로그인 사용자가 볼 수 있는 거래처 목록 + 각 거래처의 최근 매출원장 메타
//
//   GET /api/ledger?bizNumber=2110948285&from=2025-01-01&to=2025-12-31
//     → 특정 거래처의 명세 줄들 (권한 체크: 아래 권한 규칙)
//
// 권한:
//   - 모든 역할 공통: kmdUserId === 본인 User.id (KMD 계정 직접 매핑) 이거나
//     본인의 UserClient(approved=true) bizNumber 에 해당하면 조회 가능.
//   - ADMIN/BIZ 도 동일 기준 적용. 전체조회가 필요한 관리자 뷰는 /biz 영역에서 별도 제공.
//   - ?all=true 파라미터를 ADMIN 이 보내면 전체 조회 (관리 목적).

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const bizNumber = req.nextUrl.searchParams.get("bizNumber");
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const all = req.nextUrl.searchParams.get("all") === "true";

  // 관리자가 ?all=true 로 요청하면 전체 조회 (별도 관리 화면용)
  const isAdmin = user.role === "ADMIN" || user.role === "BIZ";
  const skipScope = all && isAdmin;

  // 접근 가능한 EpharmsAccount 범위: kmdUserId 직접 매핑 OR 본인 담당 거래처 bizNumber
  let scopedWhere: Prisma.EpharmsAccountWhereInput | null = null;
  if (!skipScope) {
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

    // 권한: ?all=true + ADMIN/BIZ 는 통과, 그 외는 (UserClient bizNumber 매칭) OR (kmdUserId 일치)
    if (!skipScope) {
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
        id: true, entryDate: true,
        ediCode: true, itemName: true, spec: true,
        quantity: true, unitPrice: true,
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
