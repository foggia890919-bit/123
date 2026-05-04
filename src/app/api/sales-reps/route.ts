import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function GET() {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "ADMIN" && user.role !== "BIZ") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const reps = await prisma.user.findMany({
    where: { role: "SALES_REP", approved: true },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
  return NextResponse.json({ reps });
}
