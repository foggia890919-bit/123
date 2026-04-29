import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";
import { runBackfillChunk } from "@/lib/naver/backfill";

export const maxDuration = 300; // 최대 5분 (Vercel Pro)

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { workspace } = await requireWorkspace();
    const { id } = await ctx.params;
    const job = await prisma.backfillJob.findFirst({ where: { id, workspaceId: workspace.id } });
    if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

    const url = new URL(req.url);
    const days = Math.max(1, Math.min(30, parseInt(url.searchParams.get("days") ?? "7", 10)));
    const result = await runBackfillChunk(id, days);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
