import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, canManageSubmissionRoutes } from "@/lib/auth-guard";
import { getViewableUserIds } from "@/lib/hierarchy";

// POST: 하위가 상위에게 매핑 요청 보냄  body: { targetEmail }
// GET ?box=incoming|outgoing : 본인 받은/보낸 요청 목록
// PATCH: { id, action: 'approve' | 'reject' | 'cancel' }

async function isInTree(rootId: string, candidateId: string): Promise<boolean> {
  const ids = await getViewableUserIds(rootId);
  return ids.includes(candidateId);
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!canManageSubmissionRoutes(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { targetEmail } = await req.json();
  const email = String(targetEmail ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "상위 회원 이메일이 필요해요." }, { status: 400 });

  const target = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "해당 이메일의 회원을 찾을 수 없어요." }, { status: 404 });
  if (target.id === user.id)
    return NextResponse.json({ error: "본인을 상위로 지정할 수 없어요." }, { status: 400 });

  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { parentUserId: true } });
  if (me?.parentUserId)
    return NextResponse.json({ error: "이미 상위가 설정돼 있어요. 변경은 관리자에게 문의해주세요." }, { status: 400 });

  // Cycle 양방향 검사:
  //  - target 이 본인의 후손이면 본인의 parent 로 설정 시 cycle.
  //  - 본인이 target 의 후손이면 chain 안에 이미 있는 셈 — 중복.
  const [targetInMyTree, meInTargetTree] = await Promise.all([
    isInTree(user.id, target.id),
    isInTree(target.id, user.id),
  ]);
  if (targetInMyTree)
    return NextResponse.json({ error: "선택한 회원이 본인의 하위에 있어요. 순환 매핑은 불가합니다." }, { status: 400 });
  if (meInTargetTree)
    return NextResponse.json({ error: "본인이 이미 해당 회원의 하위 트리에 속해 있어요." }, { status: 400 });

  // PENDING 중복 차단 (DB partial unique index 가 마지막 방어선)
  const dup = await prisma.parentLinkRequest.findFirst({
    where: { requesterId: user.id, status: "PENDING" },
    select: { id: true },
  });
  if (dup) return NextResponse.json({ error: "이미 진행 중인 요청이 있어요." }, { status: 400 });

  const created = await prisma.parentLinkRequest.create({
    data: {
      requesterId: user.id,
      targetId: target.id,
      targetEmailSnapshot: target.email,
      status: "PENDING",
    },
  });
  return NextResponse.json(created, { status: 201 });
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!canManageSubmissionRoutes(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const box = req.nextUrl.searchParams.get("box") ?? "outgoing";
  const where =
    box === "incoming"
      ? { targetId: user.id }
      : box === "outgoing"
      ? { requesterId: user.id }
      : null;
  if (!where) return NextResponse.json({ error: "box=incoming|outgoing" }, { status: 400 });

  const rows = await prisma.parentLinkRequest.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      requester: { select: { id: true, name: true, email: true, role: true } },
      target: { select: { id: true, name: true, email: true, role: true } },
    },
  });
  return NextResponse.json(rows);
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!canManageSubmissionRoutes(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id, action, reason } = await req.json();
  if (!id || !["approve", "reject", "cancel"].includes(action))
    return NextResponse.json({ error: "id 와 action(approve|reject|cancel) 필요" }, { status: 400 });

  const row = await prisma.parentLinkRequest.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "요청을 찾을 수 없어요." }, { status: 404 });
  if (row.status !== "PENDING")
    return NextResponse.json({ error: "이미 처리된 요청이에요." }, { status: 400 });

  if (action === "cancel") {
    if (row.requesterId !== user.id)
      return NextResponse.json({ error: "본인 요청만 취소할 수 있어요." }, { status: 403 });
    const updated = await prisma.parentLinkRequest.update({
      where: { id },
      data: { status: "CANCELED", decidedAt: new Date() },
    });
    return NextResponse.json(updated);
  }

  // approve / reject — target 만 가능
  if (row.targetId !== user.id)
    return NextResponse.json({ error: "본인에게 들어온 요청만 처리할 수 있어요." }, { status: 403 });

  if (action === "reject") {
    const updated = await prisma.parentLinkRequest.update({
      where: { id },
      data: { status: "REJECTED", decidedAt: new Date(), reason: reason ?? null },
    });
    return NextResponse.json(updated);
  }

  // approve — transaction 안에서 cycle 재검증 후 parentUserId set
  const requesterFresh = await prisma.user.findUnique({
    where: { id: row.requesterId },
    select: { parentUserId: true },
  });
  if (requesterFresh?.parentUserId)
    return NextResponse.json({ error: "요청자에게 이미 상위가 설정돼 있어요." }, { status: 400 });

  const [requesterInMyTree, meInRequesterTree] = await Promise.all([
    isInTree(user.id, row.requesterId),
    isInTree(row.requesterId, user.id),
  ]);
  if (requesterInMyTree || meInRequesterTree)
    return NextResponse.json({ error: "순환 매핑이 감지돼 승인할 수 없어요." }, { status: 400 });

  const result = await prisma.$transaction([
    prisma.parentLinkRequest.update({
      where: { id },
      data: { status: "APPROVED", decidedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: row.requesterId },
      data: { parentUserId: row.targetId },
    }),
  ]);
  return NextResponse.json(result[0]);
}
