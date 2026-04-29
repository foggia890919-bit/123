import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";
import { suggestKeywordsForProduct } from "@/lib/keyword-suggest";

export async function GET() {
  try {
    const { workspace } = await requireWorkspace();
    const products = await prisma.naverProduct.findMany({
      where: { store: { workspaceId: workspace.id } },
      include: {
        store: true,
        costs: true,
        items: { take: 10, orderBy: { paymentDate: "desc" }, select: { optionName: true } },
      },
      orderBy: [{ storeId: "asc" }, { productName: "asc" }],
    });
    const out = products.map((p) => {
      const optionNames = Array.from(
        new Set([...p.items.map((it) => it.optionName), ...p.costs.map((c) => c.optionName)].filter(Boolean)),
      );
      const suggestions = suggestKeywordsForProduct(p.productName, optionNames);
      const mapped = p.costs.length;
      const totalOptions = optionNames.length || mapped;
      return {
        id: p.id,
        storeName: p.store.storeName,
        channelProductNo: p.channelProductNo,
        productName: p.productName,
        watched: p.watched,
        suggestions,
        optionsMapped: mapped,
        optionsTotal: totalOptions,
        lastImportedAt: p.lastImportedAt,
      };
    });
    return NextResponse.json({ products: out });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
