import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function GET() {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  try {
    const reports = await prisma.prescriptionReport.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { client: { select: { id: true, clientName: true, bizNumber: true, approved: true } } },
    });
    return NextResponse.json(reports);
  } catch {
    const reports = await prisma.prescriptionReport.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(reports);
  }
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  try {
    const body = await req.json();
    const { clientId, year, month, hospitalName, companyName, imageData, ocrData, totalFee } = body;
    if (!year || !month) return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });

    let clientApprovedAtSave = false;
    if (clientId) {
      const client = await prisma.userClient.findUnique({ where: { id: clientId }, select: { approved: true, userId: true } });
      if (client && user.role !== "ADMIN" && client.userId !== user.id) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      clientApprovedAtSave = client?.approved ?? false;
    }

    const report = await prisma.prescriptionReport.create({
      data: {
        userId: user.id,
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
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  try {
    const { id, status, ocrData, totalFee, clientId } = await req.json();
    if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

    const existing = await prisma.prescriptionReport.findUnique({ where: { id }, select: { userId: true } });
    if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    if (user.role !== "ADMIN" && existing.userId !== user.id) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    let clientApprovedAtSave: boolean | undefined;
    if (clientId !== undefined) {
      if (clientId) {
        const client = await prisma.userClient.findUnique({ where: { id: clientId }, select: { approved: true, userId: true } });
        if (client && user.role !== "ADMIN" && client.userId !== user.id) {
          return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
        }
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
