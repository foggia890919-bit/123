// KMD 거래처 목록 — ePharms 계정 연동용.
// 이미 EpharmsAccount에 등록된 bizNumber는 제외하여 반환.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

export async function GET() {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  // 이미 등록된 ePharms 계정의 사업자번호 집합
  const existing = await prisma.epharmsAccount.findMany({
    select: { bizNumber: true },
  });
  const existingBizNumbers = new Set(existing.map((e) => e.bizNumber));

  // dealerType이 있는 거래처만 (법인·딜러), distinct bizNumber
  const userClients = await prisma.userClient.findMany({
    where: { dealerType: { not: null } },
    select: { bizNumber: true, clientName: true },
    orderBy: { clientName: "asc" },
  });

  // distinct by bizNumber (Prisma distinct는 select 전체 기준이므로 수동 처리)
  const seen = new Set<string>();
  const items: { bizNumber: string; clientName: string }[] = [];
  for (const uc of userClients) {
    if (seen.has(uc.bizNumber)) continue;
    seen.add(uc.bizNumber);
    if (!existingBizNumbers.has(uc.bizNumber)) {
      items.push({ bizNumber: uc.bizNumber, clientName: uc.clientName });
    }
  }

  return NextResponse.json({ items });
}
