import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

// GET /api/admin/hospitals → Client 마스터 + 점유 제약사 수
export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const rows = await prisma.client.findMany({
    select: {
      id: true,
      clientName: true,
      bizNumber: true,
      address: true,
      createdAt: true,
      _count: { select: { pharmaClaims: true } },
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
      createdAt: r.createdAt.toISOString(),
      claimCount: r._count.pharmaClaims,
    })),
  );
}
