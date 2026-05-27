import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUrl, BUCKETS } from "@/lib/storage";

export async function GET() {
  try {
    const banners = await prisma.homeBanner.findMany({
      where: { active: true },
      orderBy: { order: "asc" },
    });
    return NextResponse.json(
      banners.map((b) => ({
        ...b,
        imageUrl: b.imageKey ? publicUrl(BUCKETS.bannerImage, b.imageKey) : null,
      }))
    );
  } catch (err) {
    console.error("[banners GET]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
