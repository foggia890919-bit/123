import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { valuateListing, regionalEstimatedRent, DEFAULT_ASSUMPTIONS, type ValuationAssumptions } from "@/realestate/valuation";

export const dynamic = "force-dynamic";

function parseAssumptions(url: URL): Partial<ValuationAssumptions> {
  const num = (k: string) => {
    const v = url.searchParams.get(k);
    return v == null || v === "" ? undefined : Number(v);
  };
  return {
    ltv: num("ltv"),
    loanRatePct: num("rate"),
    acquisitionTaxPct: num("tax"),
    brokerageFeePct: num("fee"),
    monthlyOpex: num("opex"),
    depositMultiplier: num("depositMul"),
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const listingId = url.searchParams.get("listingId");
  const lawdCd = url.searchParams.get("lawdCd");
  const assumptions = parseAssumptions(url);

  if (listingId) {
    const listing = await prisma.rEListing.findUnique({
      where: { id: listingId },
      include: { agent: true },
    });
    if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const valuation = await valuateListing(listing, assumptions);
    return NextResponse.json({ listing, valuation });
  }

  if (lawdCd) {
    const cap = url.searchParams.get("cap") ? Number(url.searchParams.get("cap")) : 4;
    const months = Number(url.searchParams.get("months") ?? 12);
    const r = await regionalEstimatedRent({ lawdCd, capRatePct: cap, months });
    return NextResponse.json({ regional: r, capRatePct: cap, months, defaults: DEFAULT_ASSUMPTIONS });
  }

  return NextResponse.json({ error: "listingId 또는 lawdCd 필요" }, { status: 400 });
}
