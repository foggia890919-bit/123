import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncStoreOrders } from "@/lib/naver/sync";
import { previousDayKstRange } from "@/lib/report";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { fromIso?: string; toIso?: string };
  const range = body.fromIso && body.toIso
    ? { fromIso: body.fromIso, toIso: body.toIso, reportDate: new Date(body.fromIso) }
    : previousDayKstRange();

  const stores = await prisma.naverStore.findMany({ where: { enabled: true } });
  const results = [];
  for (const s of stores) {
    const r = await syncStoreOrders(s.id, range.fromIso, range.toIso);
    results.push(r);
  }
  return NextResponse.json({ ok: true, range, results });
}
