import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

function stripBiz(s: string): string {
  return s.replace(/\D/g, "");
}

// GET /api/clients-master?bizNumber=xxx → 사업자번호로 마스터 조회 (정보 끌어오기)
// GET /api/clients-master?q=xxx → 이름·번호 검색
export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const sp = req.nextUrl.searchParams;
  const bizRaw = sp.get("bizNumber");
  if (bizRaw) {
    const stripped = stripBiz(bizRaw);
    if (stripped.length < 10) return NextResponse.json({ found: false });
    const formatted = `${stripped.slice(0, 3)}-${stripped.slice(3, 5)}-${stripped.slice(5)}`;
    const client = await prisma.client.findFirst({
      where: { OR: [{ bizNumber: stripped }, { bizNumber: formatted }] },
      select: {
        id: true, clientName: true, bizNumber: true, address: true,
        bizFileKey: true, bizFileName: true, createdAt: true,
      },
    });
    return NextResponse.json({ found: !!client, client });
  }

  const q = sp.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json([]);
  const rows = await prisma.client.findMany({
    where: {
      OR: [
        { clientName: { contains: q, mode: "insensitive" } },
        { bizNumber: { contains: stripBiz(q) } },
      ],
    },
    select: { id: true, clientName: true, bizNumber: true, address: true },
    take: 20,
    orderBy: { clientName: "asc" },
  });
  return NextResponse.json(rows);
}

// POST /api/clients-master — 사업자번호 기준 upsert (있으면 기존 반환, 없으면 신규 생성)
export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const body = await req.json().catch(() => null);
  const bizNumberRaw = typeof body?.bizNumber === "string" ? body.bizNumber : "";
  const clientName = typeof body?.clientName === "string" ? body.clientName.trim() : "";
  const address = typeof body?.address === "string" ? body.address.trim() : null;

  const stripped = stripBiz(bizNumberRaw);
  if (stripped.length < 10) {
    return NextResponse.json({ error: "사업자번호 10자리를 입력하세요" }, { status: 400 });
  }
  if (!clientName) {
    return NextResponse.json({ error: "거래처명 필수" }, { status: 400 });
  }
  const formatted = `${stripped.slice(0, 3)}-${stripped.slice(3, 5)}-${stripped.slice(5)}`;

  const existing = await prisma.client.findFirst({
    where: { OR: [{ bizNumber: stripped }, { bizNumber: formatted }] },
  });
  if (existing) {
    return NextResponse.json({ created: false, client: existing });
  }

  const created = await prisma.client.create({
    data: {
      clientName,
      bizNumber: formatted,
      address,
      createdByUserId: user.id,
    },
  });
  return NextResponse.json({ created: true, client: created }, { status: 201 });
}
