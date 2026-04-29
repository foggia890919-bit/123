import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const cortarNo = url.searchParams.get("cortarNo");
  const propertyType = url.searchParams.get("propertyType");
  const tradeType = url.searchParams.get("tradeType");
  const since = url.searchParams.get("since"); // ISO
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
  const onlyOpen = url.searchParams.get("onlyOpen") !== "false";

  const items = await prisma.rEListing.findMany({
    where: {
      ...(cortarNo ? { cortarNo } : {}),
      ...(propertyType ? { propertyType } : {}),
      ...(tradeType ? { tradeType } : {}),
      ...(since ? { firstSeenAt: { gte: new Date(since) } } : {}),
      ...(onlyOpen ? { closedAt: null } : {}),
    },
    orderBy: { firstSeenAt: "desc" },
    take: limit,
    include: { agent: true },
  });
  return NextResponse.json({ items });
}
