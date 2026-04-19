import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompanyKey } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const categoryBCode = req.nextUrl.searchParams.get("categoryBCode")?.trim() || "";
  const settlementOnly = req.nextUrl.searchParams.get("settlement") === "true";
  const userId = req.nextUrl.searchParams.get("userId") || null;
  const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "50"), 500);
  const ingredientOnly = req.nextUrl.searchParams.get("ingredientOnly") === "true";

  if (!q && !categoryBCode) return NextResponse.json({ medications: [], total: 0 });

  const where = {
    AND: [
      settlementOnly ? { isSettlement: true } : {},
      categoryBCode
        ? { categoryB: categoryBCode }
        : ingredientOnly
          ? { ingredientName: { contains: q, mode: "insensitive" as const } }
          : {
              OR: [
                { productName: { contains: q, mode: "insensitive" as const } },
                { ingredientName: { contains: q, mode: "insensitive" as const } },
                { companyName: { contains: q, mode: "insensitive" as const } },
                { insuranceCode: { contains: q, mode: "insensitive" as const } },
              ],
            },
    ],
  };

  const [medications, total] = await Promise.all([
    prisma.medication.findMany({
      where,
      orderBy: [{ isSettlement: "desc" }, { commissionRate: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.medication.count({ where }),
  ]);

  // 로그인 회원의 추가수수료 적용 — 제약사명은 (주)/공백 무시하고 정규화 키로 매칭
  let rateMap: Record<string, number> = {};
  if (userId) {
    const rates = await prisma.memberCompanyRate.findMany({ where: { userId } });
    for (const r of rates) {
      rateMap[normalizeCompanyKey(r.companyName)] = r.additionalRate;
    }
  }

  const result = medications.map((med) => ({
    ...med,
    additionalRate: rateMap[normalizeCompanyKey(med.companyName)] ?? null,
  }));

  return NextResponse.json({ medications: result, total });
}
