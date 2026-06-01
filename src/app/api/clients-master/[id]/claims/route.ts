import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { normalizeCompanyName } from "@/lib/company-name";

// GET /api/clients-master/[id]/claims → 해당 거래처의 모든 점유 (제약사 × 점유자)
// 본인이 점유한 것 + 다른 사람 점유 표시
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { id } = await params;

  const claims = await prisma.clientPharmaClaim.findMany({
    where: { clientId: id },
    select: {
      id: true,
      companyName: true,
      userId: true,
      createdAt: true,
      memo: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    claims.map((c) => ({
      id: c.id,
      companyName: c.companyName,
      claimedAt: c.createdAt.toISOString(),
      memo: c.memo,
      isMine: c.userId === user.id,
      claimedBy: c.user?.name ?? c.user?.email ?? "?",
    })),
  );
}

// POST /api/clients-master/[id]/claims — 제약사 점유 시도
// body: { companyName: string, memo?: string }
// 이미 다른 회원이 점유 중이면 409 + 점유자 정보 반환
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const rawCompany = typeof body?.companyName === "string" ? body.companyName.trim() : "";
  const memo = typeof body?.memo === "string" ? body.memo : null;
  if (!rawCompany) return NextResponse.json({ error: "companyName 필수" }, { status: 400 });

  const companyName = normalizeCompanyName(rawCompany);

  // 거래처 존재 확인
  const client = await prisma.client.findUnique({ where: { id }, select: { id: true, clientName: true } });
  if (!client) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // 이미 점유 중인지 확인
  const existing = await prisma.clientPharmaClaim.findUnique({
    where: { clientId_companyName: { clientId: id, companyName } },
    select: {
      id: true, userId: true, createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });
  if (existing) {
    if (existing.userId === user.id) {
      return NextResponse.json({ ok: true, alreadyMine: true, claimId: existing.id });
    }
    return NextResponse.json(
      {
        error: "ALREADY_CLAIMED",
        message: `'${client.clientName} × ${companyName}'는 이미 다른 회원이 등록했습니다.`,
        claimedBy: existing.user?.name ?? existing.user?.email ?? "?",
        claimedAt: existing.createdAt.toISOString(),
      },
      { status: 409 },
    );
  }

  // 신규 점유 — 트랜잭션으로 race 차단
  try {
    const claim = await prisma.clientPharmaClaim.create({
      data: { clientId: id, companyName, userId: user.id, memo },
    });
    return NextResponse.json({ ok: true, claim }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("Unique constraint")) {
      // 동시 등록 race — 다시 조회해서 점유자 알려줌
      const conflict = await prisma.clientPharmaClaim.findUnique({
        where: { clientId_companyName: { clientId: id, companyName } },
        select: { user: { select: { name: true, email: true } } },
      });
      return NextResponse.json(
        {
          error: "ALREADY_CLAIMED",
          message: `'${companyName}'는 방금 다른 회원이 선점했습니다.`,
          claimedBy: conflict?.user?.name ?? conflict?.user?.email ?? "?",
        },
        { status: 409 },
      );
    }
    throw err;
  }
}

// DELETE /api/clients-master/[id]/claims?companyName=xxx → 본인 점유만 해제 가능
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { id } = await params;
  const rawCompany = req.nextUrl.searchParams.get("companyName")?.trim() ?? "";
  if (!rawCompany) return NextResponse.json({ error: "companyName 필요" }, { status: 400 });
  const companyName = normalizeCompanyName(rawCompany);

  const claim = await prisma.clientPharmaClaim.findUnique({
    where: { clientId_companyName: { clientId: id, companyName } },
    select: { id: true, userId: true },
  });
  if (!claim) return NextResponse.json({ ok: true, notFound: true });
  if (claim.userId !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN — 본인 점유만 해제 가능" }, { status: 403 });
  }
  await prisma.clientPharmaClaim.delete({ where: { id: claim.id } });
  return NextResponse.json({ ok: true });
}
