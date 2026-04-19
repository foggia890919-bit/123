import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, email: true, name: true, role: true,
      approved: true, createdAt: true,
    },
  });
  return NextResponse.json(users);
}

export async function PATCH(req: NextRequest) {
  const { userId, approved } = await req.json();
  const user = await prisma.user.update({
    where: { id: userId },
    data: { approved },
    select: { id: true, approved: true },
  });
  return NextResponse.json(user);
}
