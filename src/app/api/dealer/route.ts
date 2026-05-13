import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";

const VALID_TYPES = ["CORPORATION", "INDIVIDUAL", "UPPER_CORP", "LOWER_CORP", "SELF", null];

const FULL_SELECT = {
  id: true, clientName: true, bizNumber: true, dealerType: true, approved: true,
  address: true,
  managerName: true, managerPhone: true, managerEmail: true, memo: true, code: true,
  isSettlementTarget: true, isRateTarget: true,
} as const;

const SAFE_SELECT = {
  id: true, clientName: true, bizNumber: true, dealerType: true, approved: true,
} as const;

// GET /api/dealer              → 딜러 목록 (dealerType 있는 UserClient만)
// GET /api/dealer?bizNumber=xxx → 사업자번호 중복 조회
export async function GET(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const raw = req.nextUrl.searchParams.get("bizNumber");

  if (raw) {
    const stripped = raw.replace(/\D/g, "");
    const fmt = stripped.length === 10
      ? `${stripped.slice(0, 3)}-${stripped.slice(3, 5)}-${stripped.slice(5)}`
      : stripped;
    const client = await prisma.userClient.findFirst({
      where: {
        userId: user.id,
        dealerType: { not: null },
        OR: [{ bizNumber: stripped }, { bizNumber: fmt }],
      },
      select: { id: true, clientName: true, bizNumber: true, dealerType: true },
    });
    return NextResponse.json({ found: !!client, client: client ?? null });
  }

  const isSettlementTarget = req.nextUrl.searchParams.get("isSettlementTarget") === "true";

  try {
    const rows = await prisma.userClient.findMany({
      where: { userId: user.id, dealerType: { not: null }, ...(isSettlementTarget ? { isSettlementTarget: true } : {}) },
      select: FULL_SELECT,
      orderBy: { clientName: "asc" },
    });
    return NextResponse.json(rows);
  } catch {
    try {
      const rows = await prisma.userClient.findMany({
        where: { userId: user.id, dealerType: { not: null } },
        select: SAFE_SELECT,
        orderBy: { clientName: "asc" },
      });
      return NextResponse.json(rows);
    } catch {
      return NextResponse.json([]);
    }
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
    managerName, managerPhone, managerEmail, memo,
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
        managerName: managerName ?? null,
        managerPhone: managerPhone ?? null,
        managerEmail: managerEmail ?? null,
        memo: memo ?? null,
      },
      select: FULL_SELECT,
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "이미 등록된 사업자번호예요." }, { status: 409 });
    }
    // fallback: try without new columns
    if (msg.includes("column") || msg.includes("field")) {
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
          select: SAFE_SELECT,
        });
        return NextResponse.json(row, { status: 201 });
      } catch (e2) {
        const m2 = e2 instanceof Error ? e2.message : String(e2);
        return NextResponse.json({ error: m2 }, { status: 500 });
      }
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/dealer?id=xxx
export async function PATCH(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const body = await req.json();
  const { dealerType, clientName, managerName, managerPhone, managerEmail, memo } = body;

  if (dealerType !== undefined && !VALID_TYPES.includes(dealerType)) {
    return NextResponse.json({ error: "유효하지 않은 딜러 유형" }, { status: 400 });
  }

  const client = await prisma.userClient.findUnique({ where: { id }, select: { userId: true } });
  if (!client) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (client.userId !== user.id) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  // Only include fields that were explicitly provided so TypeDropdown (dealerType-only) doesn't null others
  const data: Record<string, unknown> = {};
  if (dealerType !== undefined) data.dealerType = dealerType ?? null;
  if (clientName !== undefined) data.clientName = String(clientName).trim();
  if (managerName !== undefined) data.managerName = managerName ?? null;
  if (managerPhone !== undefined) data.managerPhone = managerPhone ?? null;
  if (managerEmail !== undefined) data.managerEmail = managerEmail ?? null;
  if (memo !== undefined) data.memo = memo ?? null;
  if (body.isSettlementTarget !== undefined) data.isSettlementTarget = Boolean(body.isSettlementTarget);
  if (body.isRateTarget        !== undefined) data.isRateTarget        = Boolean(body.isRateTarget);

  try {
    const updated = await prisma.userClient.update({
      where: { id },
      data,
      select: FULL_SELECT,
    });
    return NextResponse.json(updated);
  } catch {
    // Fallback: update only safe columns if new ones aren't in DB yet
    const safeData: Record<string, unknown> = {};
    if (data.dealerType !== undefined) safeData.dealerType = data.dealerType;
    if (data.clientName !== undefined) safeData.clientName = data.clientName;
    try {
      const updated = await prisma.userClient.update({
        where: { id },
        data: safeData,
        select: SAFE_SELECT,
      });
      return NextResponse.json(updated);
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : String(e2);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }
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
