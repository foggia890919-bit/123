import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isNextResponse } from "@/lib/auth-guard";
import {
  isPromotionEligible,
  isWithinPromotionPeriod,
  calculatePromotionRate,
  promotionExpiresAt,
  promotionRemainingDays,
  classifySubmissionTiming,
} from "@/lib/promotion-calc";
import { normalizeCompanyName } from "@/lib/company-name";

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
    select: { submissionRouteId: true, submitted: true, submittedAt: true },
  });
  const submittedMap = new Map(logs.map((l) => [l.submissionRouteId, l.submitted]));
  const submittedAtMap = new Map(logs.map((l) => [l.submissionRouteId, l.submittedAt]));

  const normalizedCompanies = [...new Set(routes.map((r) => normalizeCompanyName(r.companyName)))];
  const deadlines = await prisma.companyDeadline.findMany({
    where: { companyName: { in: normalizedCompanies }, yearMonth: currentYM },
    select: { companyName: true, deadline: true },
  });
  const deadlineMap = new Map(deadlines.map((d) => [d.companyName, d.deadline]));

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
    const submittedAt = submittedAtMap.get(r.id) ?? null;
    const deadline = deadlineMap.get(normalizeCompanyName(r.companyName)) ?? null;
    const timing = classifySubmissionTiming({ submittedAt, deadline });
    // 마감일 초과 제출은 추가수수료 미적용
    const timingValid = timing === "ON_TIME" || timing === "NO_DEADLINE";

    let status: string;
    if (!eligible) status = r.requestType === "이관" ? "미적용(이관)" : "미적용";
    else if (!withinPeriod) status = "만료";
    else if (submitted && !timingValid) status = "마감초과";
    else if (submitted && timingValid) status = "적용중";
    else status = "미제출";

    return {
      submissionRouteId: r.id,
      clientName: r.clientName,
      companyName: r.companyName,
      submissionEntity: r.submissionEntity,
      requestType: r.requestType,
      routeCreatedAt: r.createdAt.toISOString(),
      isPromotionEligible: eligible && withinPeriod && timingValid,
      promotionExpiresAt: eligible ? promotionExpiresAt(r.createdAt).toISOString() : null,
      promotionRemainingDays: eligible ? promotionRemainingDays(r.createdAt, now) : null,
      baseAdditionalRate: baseRate,
      gradeDiscount: gradeDiscount ?? (corp.partnerGrade ? undefined : 0),
      finalRate: timingValid ? finalRate : baseRate,
      currentMonthSubmitted: submitted,
      submittedAt: submittedAt?.toISOString() ?? null,
      deadline: deadline?.toISOString() ?? null,
      submissionTiming: timing,
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
