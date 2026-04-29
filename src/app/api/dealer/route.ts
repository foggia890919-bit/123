import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isNextResponse } from "@/lib/auth-guard";

const VALID_TYPES = ["CORPORATION", "INDIVIDUAL", "UPPER_CORP", "LOWER_CORP", "SELF", null];

// POST /api/dealer  { clientName, bizNumber, dealerType }
export async function POST(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const { clientName, bizNumber, dealerType } = await req.json();
  if (!clientName || !bizNumber) {
    return NextResponse.json({ error: "거래처명과 사업자번호는 필수입니다." }, { status: 400 });
  }
  if (!VALID_TYPES.includes(dealerType)) {
    return NextResponse.json({ error: "유효하지 않은 딜러 유형" }, { status: 400 });
  }

  try {
    const row = await prisma.userClient.create({
      data: {
        userId: user.id,
        clientName: String(clientName).trim(),
        bizNumber: String(bizNumber).replace(/\D/g, ""),
        dealerType: dealerType ?? null,
        approved: true,
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
