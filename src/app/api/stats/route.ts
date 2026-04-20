import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const reports = await prisma.prescriptionReport.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(reports);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, year, month, hospitalName, companyName, imageData, ocrData, totalFee } = body;
    if (!userId || !year || !month) return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
    const report = await prisma.prescriptionReport.create({
      data: { userId, year, month, hospitalName, companyName, imageData, ocrData, totalFee, updatedAt: new Date() },
    });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status, ocrData, totalFee } = await req.json();
    const report = await prisma.prescriptionReport.update({
      where: { id },
      data: { status, ocrData, totalFee, updatedAt: new Date() },
    });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
