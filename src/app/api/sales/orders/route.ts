import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";

export async function GET(req: NextRequest) {
  try {
    const { workspace } = await requireWorkspace();
    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? "";
    const storeId = url.searchParams.get("storeId") ?? "";
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const size = Math.min(200, Math.max(10, parseInt(url.searchParams.get("size") ?? "50", 10)));

    const where: Record<string, unknown> = {
      order: {
        store: {
          workspaceId: workspace.id,
          ...(storeId ? { id: storeId } : {}),
        },
      },
    };
    if (q) {
      (where as { OR?: unknown[] }).OR = [
        { productName: { contains: q, mode: "insensitive" } },
        { optionName: { contains: q, mode: "insensitive" } },
        { productOrderId: { contains: q } },
        { order: { orderId: { contains: q } } },
        { order: { buyerName: { contains: q, mode: "insensitive" } } },
      ];
    }
    if (from || to) {
      (where as { paymentDate?: object }).paymentDate = {
        ...(from ? { gte: new Date(`${from}T00:00:00+09:00`) } : {}),
        ...(to ? { lt: new Date(`${to}T00:00:00+09:00`) } : {}),
      };
    }

    const [total, items] = await Promise.all([
      prisma.naverOrderItem.count({ where }),
      prisma.naverOrderItem.findMany({
        where,
        include: {
          order: { include: { store: true } },
          product: { include: { costs: { take: 1, orderBy: { effectiveAt: "desc" } } } },
        },
        orderBy: { paymentDate: "desc" },
        skip: (page - 1) * size,
        take: size,
      }),
    ]);

    return NextResponse.json({
      total,
      page,
      size,
      items: items.map((it) => ({
        id: it.id,
        productOrderId: it.productOrderId,
        orderId: it.order.orderId,
        store: it.order.store.storeName,
        buyerName: it.order.buyerName,
        paymentDate: it.paymentDate,
        productName: it.productName,
        optionName: it.optionName,
        keyword: it.product?.costs[0]?.keyword || "",
        quantity: it.quantity,
        bottlesPerUnit: it.product?.costs[0]?.bottlesPerUnit ?? 1,
        salesAmount: it.salesAmount,
        commission: it.channelCommission + it.payCommission,
        status: it.status,
        detailStatus: it.detailStatus,
      })),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
