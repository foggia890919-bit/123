import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

const PRIORITY: Record<string, number> = { APPROVED: 4, REVIEWING: 3, PENDING: 2, REJECTED: 1 };

export async function GET() {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const requests = await prisma.filterRequest.findMany({
    where: { userId: user.id },
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
