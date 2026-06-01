import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

// GET /api/admin/businesses → CSO 분류로 전환된 사업자 (role IN SALES/BIZ/ADMIN, legacy BUSINESS 포함)
export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const users = await prisma.user.findMany({
    where: {
      role: { in: ["SALES", "BIZ", "ADMIN", "BUSINESS"] },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      ownerBizClient: { select: { clientName: true, bizNumber: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      ownerClientName: u.ownerBizClient?.clientName ?? null,
      ownerBizNumber: u.ownerBizClient?.bizNumber ?? null,
    })),
  );
}
