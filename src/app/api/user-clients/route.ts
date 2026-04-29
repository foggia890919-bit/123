import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";

// GET /api/user-clients → 본인 거래처
// GET /api/user-clients?all=true → 관리자 전용, 모든 담당자의 거래처
// GET /api/user-clients?bizNumber=xxx → 사업자번호 중복 조회
export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const bizNumberCheck = req.nextUrl.searchParams.get("bizNumber");
  if (bizNumberCheck) {
    const bizNumber = bizNumberCheck.replace(/\D/g, "");
    const client = await prisma.userClient.findUnique({
      where: { userId_bizNumber: { userId: user.id, bizNumber } },
      select: { id: true, clientName: true, bizNumber: true },
    });
    return NextResponse.json({ found: !!client, client: client ?? null });
  }

  const all = req.nextUrl.searchParams.get("all") === "true";

  if (all) {
    if (user.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    // Exclude heavy bizDocument (base64) from list; download via /api/files/user-client-biz/[id]
    const rows = await prisma.userClient.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, userId: true, clientName: true, bizNumber: true,
        bizFileName: true, bizFileKey: true, approved: true, createdAt: true,
        user: { select: { name: true, email: true } },
      },
    });
    // hasBizDocument flag keeps existing UI logic working without transferring megabytes
    const annotated = rows.map((r) => ({ ...r, bizDocument: null, hasBizDocument: !!r.bizFileName }));
    return NextResponse.json(annotated);
  }

  const userId = user.id;

  // 기존 FilterRequest에서 거래처 정보를 UserClient로 자동 가져오기
  const pastRequests = await prisma.filterRequest.findMany({
    where: { userId },
    select: { clientName: true, bizNumber: true },
    distinct: ["bizNumber"],
  });
  if (pastRequests.length > 0) {
    await prisma.userClient.createMany({
      data: pastRequests.map((r) => ({
        userId,
        clientName: r.clientName,
        bizNumber: r.bizNumber,
      })),
      skipDuplicates: true,
    });
  }

  const rows = await prisma.userClient.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { clientName, bizNumber, bizDocument, bizFileName } = await req.json();
  if (!clientName || !bizNumber) {
    return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
  }
  const { fileKey: bizFileKey, fileData: bizDocumentFallback } =
    await persistDataUri(BUCKETS.userClientBiz, user.id, bizDocument);
  try {
    const row = await prisma.userClient.create({
      data: {
        userId: user.id,
        clientName: String(clientName).trim(),
        bizNumber: String(bizNumber).trim(),
        bizDocument: bizDocumentFallback,
        bizFileKey,
        bizFileName: bizFileName || null,
      },
    });
    return NextResponse.json({ ...row, bizDocument: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "이미 등록된 사업자번호예요." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
  const existing = await prisma.userClient.findUnique({ where: { id }, select: { userId: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // approved 변경은 관리자만
  const { approved } = await req.json();
  if (user.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const row = await prisma.userClient.update({ where: { id }, data: { approved: Boolean(approved) } });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
  const existing = await prisma.userClient.findUnique({ where: { id }, select: { userId: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (user.role !== "ADMIN" && existing.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  await prisma.userClient.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
