import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { publicUrl, BUCKETS } from "@/lib/storage";

function withImageUrl(b: { imageKey: string | null; [k: string]: unknown }) {
  return { ...b, imageUrl: b.imageKey ? publicUrl(BUCKETS.bannerImage, b.imageKey) : null };
}

export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const banners = await prisma.homeBanner.findMany({ orderBy: { order: "asc" } });
  return NextResponse.json(banners.map(withImageUrl));
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { title, subtitle, description, buttonText, buttonLink, imageKey, bgColor, order, active } = await req.json();
  if (!title?.trim()) return NextResponse.json({ error: "제목 필수" }, { status: 400 });
  const banner = await prisma.homeBanner.create({
    data: {
      title: title.trim(),
      subtitle: subtitle?.trim() || null,
      description: description?.trim() || null,
      buttonText: buttonText?.trim() || null,
      buttonLink: buttonLink?.trim() || null,
      imageKey: imageKey || null,
      bgColor: bgColor?.trim() || null,
      order: typeof order === "number" ? order : 0,
      active: active !== false,
    },
  });
  return NextResponse.json(withImageUrl(banner));
}
