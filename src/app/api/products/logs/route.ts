import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function GET() {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const logs = await prisma.productSyncLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ logs });
}
