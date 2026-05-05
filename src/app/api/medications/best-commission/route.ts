import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompanyKey } from "@/lib/utils";

// 성분코드별 수수료 최고 약품 반환
// POST { ingredientCodes: string[], userId?: string }
// → { [ingredientCode]: MedicationItem }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ingredientCodes: string[] = Array.isArray(body?.ingredientCodes)
    ? (body.ingredientCodes as string[]).filter(Boolean)
    : [];
  const userId = typeof body?.userId === "string" ? body.userId : null;

  if (ingredientCodes.length === 0) {
    return NextResponse.json({});
  }

  const uniqueCodes = Array.from(new Set(ingredientCodes));

  const meds = await prisma.medication.findMany({
    where: {
      ingredientCode: { in: uniqueCodes },
      price: { not: null },
    },
  });

  // 유저별 추가수수료 맵
  const rateMap: Record<string, number> = {};
  if (userId) {
    const rates = await prisma.memberCompanyRate.findMany({ where: { userId } });
    for (const r of rates) rateMap[normalizeCompanyKey(r.companyName)] = r.additionalRate;
  }

  // 성분코드별 수수료 합계 최고 약품 선택
  const best: Record<string, (typeof meds)[0] & { additionalRate: number | null }> = {};
  for (const med of meds) {
    if (!med.ingredientCode) continue;
    const additionalRate = rateMap[normalizeCompanyKey(med.companyName)] ?? null;
    const total = (med.commissionRate ?? 0) + (additionalRate ?? 0);
    const current = best[med.ingredientCode];
    if (!current) {
      best[med.ingredientCode] = { ...med, additionalRate };
      continue;
    }
    const currentTotal =
      (current.commissionRate ?? 0) + (current.additionalRate ?? 0);
    if (total > currentTotal) {
      best[med.ingredientCode] = { ...med, additionalRate };
    }
  }

  return NextResponse.json(best);
}
