import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/user-clients?userId=... → 담당자 본인의 거래처
// GET /api/user-clients?all=true → 관리자용, 모든 담당자의 거래처 (담당자 정보 포함)
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  const all = req.nextUrl.searchParams.get("all") === "true";

  if (all) {
    const rows = await prisma.userClient.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true } } },
    });
    return NextResponse.json(rows);
  }

  if (!userId) return NextResponse.json([], { status: 200 });

  const rows = await prisma.userClient.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const { userId, clientName, bizNumber, bizDocument, bizFileName } = await req.json();
  if (!userId || !clientName || !bizNumber) {
    return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
  }
  try {
    const row = await prisma.userClient.create({
      data: {
        userId,
        clientName: clientName.trim(),
        bizNumber: bizNumber.trim(),
        bizDocument: bizDocument || null,
        bizFileName: bizFileName || null,
      },
    });
    return NextResponse.json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "이미 등록된 사업자번호예요." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
  await prisma.userClient.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
