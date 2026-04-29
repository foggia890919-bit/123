import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncStoreProducts } from "@/lib/naver/products";
import { requireWorkspace } from "@/lib/workspace";

export async function POST() {
  try {
    const { workspace } = await requireWorkspace();
    const stores = await prisma.naverStore.findMany({ where: { workspaceId: workspace.id, enabled: true } });
    const results = [];
    for (const s of stores) {
      const r = await syncStoreProducts(s.id);
      results.push(r);
    }
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
