import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspace } = await requireWorkspace();
    const { id } = await ctx.params;
    const item = await prisma.naverOrderItem.findFirst({
      where: { id, order: { store: { workspaceId: workspace.id } } },
      include: {
        order: { include: { store: true } },
        product: { include: { costs: { orderBy: { effectiveAt: "desc" }, take: 1 } } },
      },
    });
    if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

    const cost = item.product?.costs[0] ?? null;
    const totalCommission = item.channelCommission + item.payCommission;
    const perUnitCost = cost ? cost.unitCost + cost.shippingCost + cost.fulfillCost + cost.packagingCost + cost.etcCost : 0;
    const totalCost = perUnitCost * item.quantity + totalCommission;
    const profit = item.salesAmount - totalCost;

    return NextResponse.json({
      item: {
        ...item,
        order: { ...item.order, raw: undefined }, // raw 는 별도 노출
      },
      raw: item.order.raw,
      cost,
      computed: {
        totalCommission,
        perUnitCost,
        totalCost,
        profit,
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
