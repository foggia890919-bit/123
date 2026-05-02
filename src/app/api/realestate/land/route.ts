import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { analyze, regionalRentBenchmark } from "@/realestate/land/analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  jibun: z.string().optional(),
  pnu: z.string().regex(/^\d{19}$/).optional(),
  scenario: z.object({
    buildingType: z.enum(["medical", "office", "mixed"]).optional(),
    floorHeight: z.number().optional(),
    efficiency: z.number().optional(),
    parkingRule: z.enum(["medical", "office"]).optional(),
    constructionUnitCost: z.number().optional(),
  }).optional(),
  assumedSaleAmount: z.number().int().nullable().optional(),
  ltv: z.number().optional(),
  loanRatePct: z.number().optional(),
  monthlyOpex: z.number().optional(),
  capRatePct: z.number().optional(),
}).refine(v => v.jibun || v.pnu, { message: "jibun 또는 pnu 필요" });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const result = await analyze({
      jibun: parsed.data.jibun,
      pnu: parsed.data.pnu,
      scenario: parsed.data.scenario as never,
      assumedSaleAmount: parsed.data.assumedSaleAmount ?? undefined,
      ltv: parsed.data.ltv,
      loanRatePct: parsed.data.loanRatePct,
      monthlyOpex: parsed.data.monthlyOpex,
      capRatePct: parsed.data.capRatePct,
    });
    const benchmark = await regionalRentBenchmark(result.parcel).catch(() => null);
    return NextResponse.json({ ...result, benchmark });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
