import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface Body {
  productId?: string;
  optionName?: string;
  keyword?: string;
  bottlesPerUnit?: number;
  unitCost?: number;
  shippingCost?: number;
  fulfillCost?: number;
  packagingCost?: number;
  etcCost?: number;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as Body;
  const data = {
    optionName: body.optionName ?? "",
    keyword: body.keyword ?? "",
    bottlesPerUnit: body.bottlesPerUnit ?? 1,
    unitCost: body.unitCost ?? 0,
    shippingCost: body.shippingCost ?? 0,
    fulfillCost: body.fulfillCost ?? 0,
    packagingCost: body.packagingCost ?? 0,
    etcCost: body.etcCost ?? 0,
  };

  if (id.startsWith("new:")) {
    if (!body.productId) return NextResponse.json({ error: "productId required" }, { status: 400 });
    const created = await prisma.productCost.create({
      data: { productId: body.productId, ...data, effectiveAt: new Date() },
    });
    return NextResponse.json({ ok: true, id: created.id });
  }

  await prisma.productCost.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await prisma.productCost.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
