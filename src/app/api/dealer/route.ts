import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";

const VALID_TYPES = ["CORPORATION", "INDIVIDUAL", "UPPER_CORP", "LOWER_CORP", "SELF", null];

// GET /api/dealer              → 딜러 목록 (dealerType 있는 UserClient만)
// GET /api/dealer?bizNumber=xxx → 사업자번호 중복 조회
export async function GET(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const raw = req.nextUrl.searchParams.get("bizNumber");

  // bizNumber 중복 조회 모드
  if (raw) {
    const bizNumber = raw.replace(/\D/g, "");
    const client = await prisma.userClient.findUnique({
      where: { userId_bizNumber: { userId: user.id, bizNumber } },
      select: { id: true, clientName: true, bizNumber: true, dealerType: true },
    });
    return NextResponse.json({ found: !!client, client: client ?? null });
  }

  // 목록 모드: 딜러로 등록된 UserClient만 반환
  try {
    const rows = await prisma.userClient.findMany({
      where: { userId: user.id, dealerType: { not: null } },
      select: { id: true, clientName: true, bizNumber: true, dealerType: true, approved: true },
      orderBy: { clientName: "asc" },
    });
    return NextResponse.json(rows);
  } catch {
    // dealerType 컬럼이 아직 DB에 없음 — 마이그레이션 필요
    return NextResponse.json([]);
  }
}

// POST /api/dealer
export async function POST(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const {
    clientName, bizNumber, dealerType,
    bizDocument, bizFileName,
    csoDocument, csoFileName,
    accountDocument, accountFileName,
  } = await req.json();

  if (!clientName || !bizNumber) {
    return NextResponse.json({ error: "거래처명과 사업자번호는 필수입니다." }, { status: 400 });
  }
  if (!VALID_TYPES.includes(dealerType)) {
    return NextResponse.json({ error: "유효하지 않은 딜러 유형" }, { status: 400 });
  }

  const [
    { fileKey: bizFileKey, fileData: bizDocFallback },
    { fileKey: csoFileKey },
    { fileKey: accountFileKey },
  ] = await Promise.all([
    persistDataUri(BUCKETS.userClientBiz, `${user.id}/biz`, bizDocument ?? null),
    persistDataUri(BUCKETS.userClientBiz, `${user.id}/cso`, csoDocument ?? null),
    persistDataUri(BUCKETS.userClientBiz, `${user.id}/account`, accountDocument ?? null),
  ]);

  try {
    const row = await prisma.userClient.create({
      data: {
        userId: user.id,
        clientName: String(clientName).trim(),
        bizNumber: String(bizNumber).replace(/\D/g, ""),
        dealerType: dealerType ?? null,
        approved: true,
        bizDocument: bizDocFallback,
        bizFileKey: bizFileKey ?? null,
        bizFileName: bizFileName ?? null,
        csoFileKey: csoFileKey ?? null,
        csoFileName: csoFileName ?? null,
        accountFileKey: accountFileKey ?? null,
        accountFileName: accountFileName ?? null,
      },
      select: { id: true, clientName: true, bizNumber: true, dealerType: true, approved: true },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "이미 등록된 사업자번호예요." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/dealer?id=xxx  { dealerType }
export async function PATCH(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const { dealerType } = await req.json();
  if (!VALID_TYPES.includes(dealerType)) {
    return NextResponse.json({ error: "유효하지 않은 딜러 유형" }, { status: 400 });
  }

  const client = await prisma.userClient.findUnique({ where: { id }, select: { userId: true } });
  if (!client) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (client.userId !== user.id) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const updated = await prisma.userClient.update({
    where: { id },
    data: { dealerType: dealerType ?? null },
    select: { id: true, clientName: true, bizNumber: true, dealerType: true },
  });
  return NextResponse.json(updated);
}

// DELETE /api/dealer?id=xxx
export async function DELETE(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const client = await prisma.userClient.findUnique({ where: { id }, select: { userId: true } });
  if (!client) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (client.userId !== user.id) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  await prisma.userClient.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
