import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const requests = await prisma.filterRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } } },
  });
  return NextResponse.json(requests);
}

export async function POST(req: NextRequest) {
  const { userId, userName, clientName, bizNumber, bizDocument, bizFileName, companies } = await req.json();

  if (!userId || !clientName || !bizNumber || !companies?.length) {
    return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
  }

  await prisma.filterRequest.createMany({
    data: (companies as string[]).map((companyName: string) => ({
      id: crypto.randomUUID(),
      userId,
      userName,
      clientName,
      bizNumber,
      bizDocument: bizDocument || null,
      bizFileName: bizFileName || null,
      companyName,
      updatedAt: new Date(),
    })),
  });

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  const { id, status } = await req.json();
  const updated = await prisma.filterRequest.update({
    where: { id },
    data: { status, updatedAt: new Date() },
  });
  return NextResponse.json(updated);
}
