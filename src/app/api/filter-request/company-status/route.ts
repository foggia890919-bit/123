import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PRIORITY: Record<string, number> = { APPROVED: 4, REVIEWING: 3, PENDING: 2, REJECTED: 1 };

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({}, { status: 400 });

  const requests = await prisma.filterRequest.findMany({
    where: { userId },
    select: { companyName: true, status: true },
  });

  const result: Record<string, string> = {};
  for (const r of requests) {
    if (!result[r.companyName] || PRIORITY[r.status] > PRIORITY[result[r.companyName]]) {
      result[r.companyName] = r.status;
    }
  }

  return NextResponse.json(result);
}
