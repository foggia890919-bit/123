import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

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
  } catch (err) {
    console.error("[visits GET]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
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
  // 로그인한 사용자의 방문만 카운트 — 익명 봇/자동화 요청 차단
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  try {
    await Promise.all([increment("visits_total"), increment(todayKey())]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[visits POST]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
