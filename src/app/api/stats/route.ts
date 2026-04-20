import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  try {
    const reports = await prisma.prescriptionReport.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { client: { select: { id: true, clientName: true, bizNumber: true, approved: true } } },
    });
    return NextResponse.json(reports);
  } catch {
    const reports = await prisma.prescriptionReport.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(reports);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, clientId, year, month, hospitalName, companyName, imageData, ocrData, totalFee } = body;
    if (!userId || !year || !month) return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });

    let clientApprovedAtSave = false;
    if (clientId) {
      const client = await prisma.userClient.findUnique({ where: { id: clientId }, select: { approved: true } });
      clientApprovedAtSave = client?.approved ?? false;
    }

    const report = await prisma.prescriptionReport.create({
      data: {
        userId,
        clientId: clientId || null,
        year,
        month,
        hospitalName,
        companyName,
        imageData,
        ocrData,
        totalFee,
        clientApprovedAtSave,
        updatedAt: new Date(),
      },
    });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status, ocrData, totalFee, clientId } = await req.json();

    let clientApprovedAtSave: boolean | undefined;
    if (clientId !== undefined) {
      if (clientId) {
        const client = await prisma.userClient.findUnique({ where: { id: clientId }, select: { approved: true } });
        clientApprovedAtSave = client?.approved ?? false;
      } else {
        clientApprovedAtSave = false;
      }
    }

    const report = await prisma.prescriptionReport.update({
      where: { id },
      data: {
        status,
        ocrData,
        totalFee,
        ...(clientId !== undefined && { clientId: clientId || null }),
        ...(clientApprovedAtSave !== undefined && { clientApprovedAtSave }),
        updatedAt: new Date(),
      },
    });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
