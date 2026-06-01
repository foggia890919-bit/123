import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

// GET /api/admin/hospitals → 전체 회원이 등록한 병의원 거래처 (dealerType IS NULL)
export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const rows = await prisma.userClient.findMany({
    where: { dealerType: null },
    select: {
      id: true,
      clientName: true,
      bizNumber: true,
      address: true,
      approved: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      clientName: r.clientName,
      bizNumber: r.bizNumber,
      address: r.address,
      approved: r.approved,
      createdAt: r.createdAt.toISOString(),
      ownerName: r.user?.name ?? null,
      ownerEmail: r.user?.email ?? null,
    })),
  );
}
