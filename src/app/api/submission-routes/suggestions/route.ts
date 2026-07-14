import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, canManageSubmissionRoutes } from "@/lib/auth-guard";

// 통계제출처 매핑 폼 자동완성용 — `/api/filter-mapping/suggestions` 는 BIZ/ADMIN 권한
// 한정이라 BUSINESS/BASIC 사용자가 못 쓰는 문제 해결.
//
// 보안: user-scoped — 본인이 등록한 SubmissionRoute 의 DISTINCT 값만 + 상위법인은
// FilterMapping 표준 list (BIZ 가 등록한 공용) 도 합쳐 노출.
// 다른 사용자의 거래처/제약사 데이터는 노출 안 됨.

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!canManageSubmissionRoutes(user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const type = req.nextUrl.searchParams.get("type");

  if (type === "client") {
    // 본인이 이미 등록한 거래처 + 본인 UserClient 거래처 합치기 (dealerType=null = 병원 거래처만)
    const [routes, userClients] = await Promise.all([
      prisma.submissionRoute.findMany({
        where: { ownerId: user.id },
        select: { clientName: true },
        distinct: ["clientName"],
        orderBy: { clientName: "asc" },
        take: 100,
      }),
      prisma.userClient.findMany({
        where: { userId: user.id, dealerType: null },
        select: { clientName: true },
        distinct: ["clientName"],
        orderBy: { clientName: "asc" },
        take: 100,
      }).catch(() => []),
    ]);
    const set = new Set<string>();
    routes.forEach((r) => set.add(r.clientName));
    userClients.forEach((c) => set.add(c.clientName));
    return NextResponse.json(Array.from(set).sort());
  }

  if (type === "company") {
    // 본인 SubmissionRoute + 본인 MemberCompanyRate 의 제약사
    const [routes, rates] = await Promise.all([
      prisma.submissionRoute.findMany({
        where: { ownerId: user.id },
        select: { companyName: true },
        distinct: ["companyName"],
        orderBy: { companyName: "asc" },
        take: 100,
      }),
      prisma.memberCompanyRate.findMany({
        where: { userId: user.id },
        select: { companyName: true },
        distinct: ["companyName"],
        orderBy: { companyName: "asc" },
        take: 100,
      }).catch(() => []),
    ]);
    const set = new Set<string>();
    routes.forEach((r) => set.add(r.companyName));
    rates.forEach((r) => set.add(r.companyName));
    return NextResponse.json(Array.from(set).sort());
  }

  if (type === "submissionEntity") {
    // 본인 history + FilterMapping 의 표준 상위법인 list (BIZ 가 등록한 공용)
    const [own, standard] = await Promise.all([
      prisma.submissionRoute.findMany({
        where: { ownerId: user.id },
        select: { submissionEntity: true },
        distinct: ["submissionEntity"],
        take: 100,
      }),
      prisma.filterMapping.findMany({
        where: { active: true },
        select: { submissionEntity: true },
        distinct: ["submissionEntity"],
        take: 200,
      }).catch(() => []),
    ]);
    const set = new Set<string>();
    own.forEach((r) => set.add(r.submissionEntity));
    standard.forEach((r) => set.add(r.submissionEntity));
    return NextResponse.json(Array.from(set).sort());
  }

  return NextResponse.json(
    { error: "type 파라미터가 필요합니다 (client | company | submissionEntity)" },
    { status: 400 },
  );
}
