import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";

interface PatchBody {
  storeName?: string;
  bizName?: string;
  clientId?: string;
  clientSecret?: string;
  enabled?: boolean;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspace } = await requireWorkspace();
    const { id } = await ctx.params;
    const existing = await prisma.naverStore.findFirst({ where: { id, workspaceId: workspace.id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const b = (await req.json()) as PatchBody;
    const data: Record<string, unknown> = {};
    for (const k of ["storeName", "bizName", "clientId", "enabled"] as const) {
      if (b[k] !== undefined) data[k] = b[k];
    }
    if (b.clientSecret !== undefined && b.clientSecret !== "***" && b.clientSecret !== "") {
      data.clientSecret = b.clientSecret;
    }
    await prisma.naverStore.update({ where: { id }, data });
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
    const existing = await prisma.naverStore.findFirst({ where: { id, workspaceId: workspace.id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.naverStore.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
