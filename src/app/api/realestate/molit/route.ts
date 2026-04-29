import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const lawdCd = url.searchParams.get("lawdCd");
  const dealKind = url.searchParams.get("dealKind");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 1000);

  const items = await prisma.molitTrade.findMany({
    where: {
      ...(lawdCd ? { lawdCd } : {}),
      ...(dealKind ? { dealKind } : {}),
    },
    orderBy: [{ dealYearMonth: "desc" }, { dealDay: "desc" }],
    take: limit,
  });
  return NextResponse.json({ items });
}
