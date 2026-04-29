import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";

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

async function ensureWorkspaceProduct(workspaceId: string, productId: string) {
  return prisma.naverProduct.findFirst({
    where: { id: productId, store: { workspaceId } },
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspace } = await requireWorkspace();
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
      const p = await ensureWorkspaceProduct(workspace.id, body.productId);
      if (!p) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const created = await prisma.productCost.create({
        data: { productId: body.productId, ...data, effectiveAt: new Date() },
      });
      return NextResponse.json({ ok: true, id: created.id });
    }

    const cost = await prisma.productCost.findFirst({
      where: { id, product: { store: { workspaceId: workspace.id } } },
    });
    if (!cost) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.productCost.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspace } = await requireWorkspace();
    const { id } = await ctx.params;
    const cost = await prisma.productCost.findFirst({
      where: { id, product: { store: { workspaceId: workspace.id } } },
    });
    if (!cost) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.productCost.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
