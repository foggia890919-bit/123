import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function todayKey() {
  return `visits_${new Date().toISOString().slice(0, 10)}`;
}

export async function GET() {
  try {
    const [total, today] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: "visits_total" } }),
      prisma.systemSetting.findUnique({ where: { key: todayKey() } }),
    ]);
    return NextResponse.json({
      total: parseInt(total?.value ?? "0"),
      today: parseInt(today?.value ?? "0"),
    });
  } catch {
    return NextResponse.json({ total: 0, today: 0 });
  }
}

async function increment(key: string) {
  const now = new Date();
  const existing = await prisma.systemSetting.findUnique({ where: { key } });
  if (existing) {
    await prisma.systemSetting.update({
      where: { key },
      data: { value: String(parseInt(existing.value) + 1), updatedAt: now },
    });
  } else {
    await prisma.systemSetting.create({ data: { key, value: "1", updatedAt: now } });
  }
}

export async function POST() {
  try {
    await Promise.all([increment("visits_total"), increment(todayKey())]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
