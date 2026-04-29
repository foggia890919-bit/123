import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";

interface PatchBody {
  keyword?: string;
  patterns?: string;
  priority?: number;
  bottlesRule?: string | null;
  enabled?: boolean;
}

async function ownsRule(workspaceId: string, id: string) {
  return prisma.keywordRule.findFirst({ where: { id, workspaceId } });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspace } = await requireWorkspace();
    const { id } = await ctx.params;
    if (!(await ownsRule(workspace.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
    const b = (await req.json()) as PatchBody;
    const data: Record<string, unknown> = {};
    if (b.keyword !== undefined) data.keyword = b.keyword;
    if (b.patterns !== undefined) data.patterns = b.patterns;
    if (b.priority !== undefined) data.priority = b.priority;
    if (b.bottlesRule !== undefined) data.bottlesRule = b.bottlesRule || null;
    if (b.enabled !== undefined) data.enabled = b.enabled;
    await prisma.keywordRule.update({ where: { id }, data });
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
    if (!(await ownsRule(workspace.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
    await prisma.keywordRule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
