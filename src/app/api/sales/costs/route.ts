import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSheetUrl } from "@/lib/sheets";

export async function GET() {
  const products = await prisma.naverProduct.findMany({
    include: { store: true, costs: { orderBy: { effectiveAt: "desc" }, take: 1 } },
    orderBy: [{ storeId: "asc" }, { productName: "asc" }],
  });
  const rows = products.flatMap((p) => {
    if (p.costs.length === 0) {
      return [
        {
          id: `new:${p.id}`,
          productId: p.id,
          storeName: p.store.storeName,
          productName: p.productName,
          channelProductNo: p.channelProductNo,
          optionName: "",
          unitCost: 0,
          shippingCost: 0,
          fulfillCost: 0,
          packagingCost: 0,
          etcCost: 0,
        },
      ];
    }
    return p.costs.map((c) => ({
      id: c.id,
      productId: p.id,
      storeName: p.store.storeName,
      productName: p.productName,
      channelProductNo: p.channelProductNo,
      optionName: c.optionName,
      unitCost: c.unitCost,
      shippingCost: c.shippingCost,
      fulfillCost: c.fulfillCost,
      packagingCost: c.packagingCost,
      etcCost: c.etcCost,
    }));
  });
  return NextResponse.json({ rows, sheetUrl: getSheetUrl() });
}
