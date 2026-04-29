import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncStoreProducts } from "@/lib/naver/products";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stores = await prisma.naverStore.findMany({ where: { enabled: true } });
  const results = [];
  for (const s of stores) {
    try {
      const r = await syncStoreProducts(s.id);
      results.push(r);
    } catch (err) {
      results.push({ store: s.code, added: 0, total: 0, errors: [err instanceof Error ? err.message : String(err)] });
    }
  }
  return NextResponse.json({ ok: true, results });
}
