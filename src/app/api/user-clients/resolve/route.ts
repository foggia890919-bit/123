import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { normalizeCompanyName, companyNameKey } from "@/lib/company-name";

// POST { clientName }
// 현재 사용자의 UserClient(dealerType null, clientName companyNameKey 일치)를 조회, 없으면 생성.
// SubmissionRoute 에만 존재하던 거래처(UserClient 명부 미등록)를 처방통계 업로드에 필요한
// clientId 로 승격시키는 용도. bizNumber 는 임시 placeholder(추후 거래처관리에서 보완).
export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const { clientName } = await req.json();
  const nm = normalizeCompanyName(String(clientName ?? "").trim());
  if (!nm) return NextResponse.json({ error: "clientName 필수" }, { status: 400 });
  const key = companyNameKey(nm);

  try {
    const existing = await prisma.userClient.findMany({
      where: { userId: user.id, dealerType: null },
      select: { id: true, clientName: true, bizNumber: true, approved: true },
    });
    const found = existing.find((u) => companyNameKey(u.clientName) === key);
    if (found) return NextResponse.json(found);

    const created = await prisma.userClient.create({
      data: { userId: user.id, clientName: nm, bizNumber: `temp-${crypto.randomUUID().slice(0, 8)}`, dealerType: null },
      select: { id: true, clientName: true, bizNumber: true, approved: true },
    });
    return NextResponse.json(created);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) {
      // 동시성으로 방금 생성된 경우 재조회
      const again = await prisma.userClient.findFirst({
        where: { userId: user.id, dealerType: null, clientName: nm },
        select: { id: true, clientName: true, bizNumber: true, approved: true },
      });
      if (again) return NextResponse.json(again);
    }
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}
