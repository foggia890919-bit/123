import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";

interface PatchBody {
  watched?: boolean;
  productName?: string;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspace } = await requireWorkspace();
    const { id } = await ctx.params;
    const product = await prisma.naverProduct.findFirst({
      where: { id, store: { workspaceId: workspace.id } },
    });
    if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = (await req.json()) as PatchBody;
    const data: Record<string, unknown> = {};
    if (body.watched !== undefined) data.watched = body.watched;
    if (body.productName !== undefined) data.productName = body.productName;
    await prisma.naverProduct.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
