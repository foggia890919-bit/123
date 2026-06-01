import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isNextResponse } from "@/lib/auth-guard";
import type { Prisma } from "@prisma/client";

// GET /api/biz/users-by-role?role=HOSPITAL|PHARMACY|CSO|GENERAL
// BIZ/ADMIN만 조회 가능
export async function GET(req: NextRequest) {
  const guard = await requireRole("BIZ");
  if (isNextResponse(guard)) return guard;

  const role = req.nextUrl.searchParams.get("role") ?? "";

  let where: Prisma.UserWhereInput | undefined;
  if (role === "HOSPITAL") where = { role: { in: ["HOSPITAL", "DOCTOR"] } };
  else if (role === "PHARMACY") where = { role: { in: ["PHARMACY", "PHARMACIST"] } };
  else if (role === "CSO") where = { role: { in: ["SALES", "BIZ", "ADMIN", "BUSINESS"] } };
  else if (role === "GENERAL") where = { role: { in: ["GENERAL", "BASIC"] } };
  // ALL은 where 없이 전체

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true, name: true, email: true, phone: true, role: true, createdAt: true,
      ownerBizClientId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  // ownerBizClientId가 있는 경우 별도 조회 (relation은 select에서 따로 못 가져오는 케이스 fallback)
  const bizClientIds = users.map((u) => u.ownerBizClientId).filter((id): id is string => !!id);
  const bizClients = bizClientIds.length > 0
    ? await prisma.userClient.findMany({
        where: { id: { in: bizClientIds } },
        select: { id: true, clientName: true, bizNumber: true },
      })
    : [];
  const bizClientMap = new Map(bizClients.map((c) => [c.id, c]));

  return NextResponse.json(
    users.map((u) => {
      const biz = u.ownerBizClientId ? bizClientMap.get(u.ownerBizClientId) : null;
      return {
        id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
        createdAt: u.createdAt.toISOString(),
        clientName: biz?.clientName ?? null,
        bizNumber: biz?.bizNumber ?? null,
      };
    }),
  );
}
