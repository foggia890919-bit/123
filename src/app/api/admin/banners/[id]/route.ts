import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { deleteObject, BUCKETS } from "@/lib/storage";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { id } = await params;
  const body = await req.json();
  const banner = await prisma.homeBanner.update({
    where: { id },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.subtitle !== undefined && { subtitle: body.subtitle || null }),
      ...(body.description !== undefined && { description: body.description || null }),
      ...(body.buttonText !== undefined && { buttonText: body.buttonText || null }),
      ...(body.buttonLink !== undefined && { buttonLink: body.buttonLink || null }),
      ...(body.imageKey !== undefined && { imageKey: body.imageKey || null }),
      ...(body.bgColor !== undefined && { bgColor: body.bgColor || null }),
      ...(body.order !== undefined && { order: body.order }),
      ...(body.active !== undefined && { active: body.active }),
    },
  });
  return NextResponse.json(banner);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { id } = await params;
  const banner = await prisma.homeBanner.findUnique({ where: { id } });
  if (banner?.imageKey) await deleteObject(BUCKETS.bannerImage, banner.imageKey);
  await prisma.homeBanner.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
