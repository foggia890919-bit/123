import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

// GET /api/mypage/client-companies?clientId=xxx
// 해당 거래처의 거래가능(APPROVED) 제약사 목록 반환
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json([]);

  const client = await prisma.userClient.findUnique({
    where: { id: clientId },
    select: { bizNumber: true },
  });
  if (!client) return NextResponse.json([]);

  const filters = await prisma.filterRequest.findMany({
    where: { bizNumber: client.bizNumber, status: "APPROVED" },
    select: { companyName: true },
    distinct: ["companyName"],
    orderBy: { companyName: "asc" },
  });

  return NextResponse.json(filters.map((f) => f.companyName));
}
