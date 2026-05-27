import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isNextResponse } from "@/lib/auth-guard";
import {
  isPromotionEligible,
  isWithinPromotionPeriod,
  calculatePromotionRate,
  promotionExpiresAt,
  promotionRemainingDays,
} from "@/lib/promotion-calc";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const { id } = await params;

  const corp = await prisma.userClient.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      clientName: true,
      corpClassification: true,
      partnerGrade: true,
      promotionBaseDate: true,
    },
  });
  if (!corp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (corp.userId !== user.id) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const sort = req.nextUrl.searchParams.get("sort") === "asc" ? "asc" as const : "desc" as const;

  const routes = await prisma.submissionRoute.findMany({
    where: { ownerId: user.id, active: true },
    select: {
      id: true,
      clientName: true,
      companyName: true,
      submissionEntity: true,
      requestType: true,
      createdAt: true,
    },
    orderBy: { createdAt: sort },
  });

  const companyNames = [...new Set(routes.map((r) => r.companyName))];
  const rates = await prisma.corpCompanyRate.findMany({
    where: { corpName: corp.clientName, companyName: { in: companyNames } },
    select: { companyName: true, additionalRate: true },
  });
  const rateMap = new Map(rates.map((r) => [r.companyName, r.additionalRate]));

  const now = new Date();
  const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const routeIds = routes.map((r) => r.id);
  const logs = await prisma.monthlySubmissionLog.findMany({
    where: { submissionRouteId: { in: routeIds }, yearMonth: currentYM },
    select: { submissionRouteId: true, submitted: true },
  });
  const submittedMap = new Map(logs.map((l) => [l.submissionRouteId, l.submitted]));

  const items = routes.map((r) => {
    const eligible = isPromotionEligible({
      corpClassification: corp.corpClassification,
      promotionBaseDate: corp.promotionBaseDate,
      routeCreatedAt: r.createdAt,
      requestType: r.requestType,
    });
    const withinPeriod = eligible && isWithinPromotionPeriod(r.createdAt, now);
    const baseRate = rateMap.get(r.companyName) ?? 0;
    const gradeDiscount = eligible && withinPeriod ? undefined : 0;
    const finalRate = eligible && withinPeriod
      ? calculatePromotionRate(baseRate, corp.partnerGrade)
      : baseRate;
    const submitted = submittedMap.get(r.id) ?? false;

    let status: string;
    if (!eligible) status = r.requestType === "이관" ? "미적용(이관)" : "미적용";
    else if (!withinPeriod) status = "만료";
    else if (submitted) status = "적용중";
    else status = "미제출";

    return {
      submissionRouteId: r.id,
      clientName: r.clientName,
      companyName: r.companyName,
      submissionEntity: r.submissionEntity,
      requestType: r.requestType,
      routeCreatedAt: r.createdAt.toISOString(),
      isPromotionEligible: eligible && withinPeriod,
      promotionExpiresAt: eligible ? promotionExpiresAt(r.createdAt).toISOString() : null,
      promotionRemainingDays: eligible ? promotionRemainingDays(r.createdAt, now) : null,
      baseAdditionalRate: baseRate,
      gradeDiscount: gradeDiscount ?? (corp.partnerGrade ? undefined : 0),
      finalRate,
      currentMonthSubmitted: submitted,
      status,
    };
  });

  return NextResponse.json({
    corp: {
      id: corp.id,
      clientName: corp.clientName,
      corpClassification: corp.corpClassification,
      partnerGrade: corp.partnerGrade,
      promotionBaseDate: corp.promotionBaseDate?.toISOString() ?? null,
    },
    items,
  });
}
