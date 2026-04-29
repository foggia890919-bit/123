import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncStoreOrders } from "@/lib/naver/sync";
import { previousDayKstRange } from "@/lib/report";
import { requireWorkspace } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  try {
    const { workspace } = await requireWorkspace();
    const body = (await req.json().catch(() => ({}))) as { fromIso?: string; toIso?: string };
    const range = body.fromIso && body.toIso
      ? { fromIso: body.fromIso, toIso: body.toIso, reportDate: new Date(body.fromIso) }
      : previousDayKstRange();

    const stores = await prisma.naverStore.findMany({ where: { workspaceId: workspace.id, enabled: true } });
    const results = [];
    for (const s of stores) {
      const r = await syncStoreOrders(s.id, range.fromIso, range.toIso);
      results.push(r);
    }
    return NextResponse.json({ ok: true, range, results });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
