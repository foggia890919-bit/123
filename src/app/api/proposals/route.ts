import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, userId, items } = body;

    if (!title || !userId || !items?.length) {
      return NextResponse.json({ error: "필수 항목이 없어요." }, { status: 400 });
    }

    const proposal = await prisma.proposal.create({
      data: {
        title,
        userId,
        items: {
          create: items.map(
            (item: {
              originalMedicationId?: string;
              altMedicationId?: string;
              quantity?: number;
              note?: string;
              order?: number;
            }, index: number) => ({
              originalMedicationId: item.originalMedicationId || null,
              altMedicationId: item.altMedicationId || null,
              quantity: item.quantity || 1,
              note: item.note || null,
              order: item.order ?? index,
            })
          ),
        },
      },
      include: {
        items: {
          include: {
            originalMedication: true,
            altMedication: true,
          },
          orderBy: { order: "asc" },
        },
      },
    });

    return NextResponse.json(proposal);
  } catch (error) {
    console.error("Proposal create error:", error);
    return NextResponse.json({ error: "제안서 저장에 실패했어요." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId가 필요해요." }, { status: 400 });
  }

  const proposals = await prisma.proposal.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });

  return NextResponse.json(proposals);
}
