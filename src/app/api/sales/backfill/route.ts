import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";
import { kstMidnight } from "@/lib/naver/backfill";

export async function GET() {
  try {
    const { workspace } = await requireWorkspace();
    const jobs = await prisma.backfillJob.findMany({
      where: { workspaceId: workspace.id },
      include: { store: { select: { id: true, code: true, storeName: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ jobs });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

interface CreateBody {
  storeId?: string;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;   // YYYY-MM-DD
}

export async function POST(req: NextRequest) {
  try {
    const { workspace } = await requireWorkspace();
    const b = (await req.json()) as CreateBody;
    if (!b.storeId || !b.fromDate || !b.toDate) {
      return NextResponse.json({ error: "storeId/fromDate/toDate required" }, { status: 400 });
    }
    const store = await prisma.naverStore.findFirst({ where: { id: b.storeId, workspaceId: workspace.id } });
    if (!store) return NextResponse.json({ error: "store not found" }, { status: 404 });

    const from = kstMidnight(new Date(`${b.fromDate}T00:00:00+09:00`));
    const to = kstMidnight(new Date(`${b.toDate}T00:00:00+09:00`));
    if (to <= from) return NextResponse.json({ error: "toDate must be after fromDate" }, { status: 400 });
    const days = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
    if (days > 400) return NextResponse.json({ error: "max 400 days" }, { status: 400 });

    const job = await prisma.backfillJob.create({
      data: {
        workspaceId: workspace.id,
        storeId: store.id,
        fromDate: from,
        toDate: to,
        cursor: from,
        status: "PENDING",
      },
    });
    return NextResponse.json({ ok: true, jobId: job.id, days });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
