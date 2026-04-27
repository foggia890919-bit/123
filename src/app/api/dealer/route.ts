import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isNextResponse } from "@/lib/auth-guard";

const VALID_TYPES = ["CORPORATION", "INDIVIDUAL", "UPPER_CORP", "LOWER_CORP", "SELF", null];

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
