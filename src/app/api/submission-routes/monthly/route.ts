import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, canManageSubmissionRoutes } from "@/lib/auth-guard";
import { getViewableUserIds } from "@/lib/hierarchy";

async function visibleOwnerIds(user: { id: string; role: string }): Promise<string[] | null> {
  if (user.role === "ADMIN") return null;
  const [viewable, admins] = await Promise.all([
    getViewableUserIds(user.id),
    prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } }),
  ]);
  return [...new Set([...viewable, ...admins.map((a) => a.id)])];
}

// GET /api/submission-routes/monthly?yearMonth=YYYY-MM
// 해당 월의 제출처별 제출 체크리스트 (제출처 그룹 + 미제출 강조)
//
// PATCH /api/submission-routes/monthly
//   body: { yearMonth, submissionRouteId, submitted, memo? }
//   토글: 해당 월 + 라우트의 제출 상태 업서트
//
// POST /api/submission-routes/monthly/bulk
//   body: { yearMonth, submissionEntity, submitted }
//   해당 제출처 전체 일괄 토글

const YM_RE = /^\d{4}-\d{2}$/;

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!canManageSubmissionRoutes(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const yearMonth = req.nextUrl.searchParams.get("yearMonth");
  if (!yearMonth || !YM_RE.test(yearMonth))
    return NextResponse.json({ error: "yearMonth (YYYY-MM) 필요" }, { status: 400 });

  const owners = await visibleOwnerIds(user);
  const routes = await prisma.submissionRoute.findMany({
    where: { active: true, ...(owners ? { ownerId: { in: owners } } : {}) },
    orderBy: [{ submissionEntity: "asc" }, { clientName: "asc" }],
  });

  const logs = await prisma.monthlySubmissionLog.findMany({
    where: { yearMonth },
  });
  const logMap = new Map(logs.map((l) => [l.submissionRouteId, l]));

  type EntityGroup = {
    submissionEntity: string;
    total: number;
    submitted: number;
    items: Array<{
      id: string;
      clientName: string;
      companyName: string;
      submissionEmail: string | null;
      requestType: string;
      submitted: boolean;
      submittedAt: string | null;
      memo: string | null;
    }>;
  };

  const groupMap = new Map<string, EntityGroup>();
  for (const r of routes) {
    if (!groupMap.has(r.submissionEntity)) {
      groupMap.set(r.submissionEntity, {
        submissionEntity: r.submissionEntity,
        total: 0,
        submitted: 0,
        items: [],
      });
    }
    const g = groupMap.get(r.submissionEntity)!;
    const log = logMap.get(r.id);
    const submitted = log?.submitted ?? false;
    g.total++;
    if (submitted) g.submitted++;
    g.items.push({
      id: r.id,
      clientName: r.clientName,
      companyName: r.companyName,
      submissionEmail: r.submissionEmail,
      requestType: r.requestType,
      submitted,
      submittedAt: log?.submittedAt?.toISOString() ?? null,
      memo: log?.memo ?? null,
    });
  }

  const groups = Array.from(groupMap.values());
  return NextResponse.json({ yearMonth, groups });
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!canManageSubmissionRoutes(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { yearMonth, submissionRouteId, submitted, memo } = await req.json();
  if (!yearMonth || !YM_RE.test(yearMonth))
    return NextResponse.json({ error: "yearMonth (YYYY-MM) 필요" }, { status: 400 });
  if (!submissionRouteId)
    return NextResponse.json({ error: "submissionRouteId 필요" }, { status: 400 });

  const route = await prisma.submissionRoute.findUnique({ where: { id: submissionRouteId }, select: { id: true, ownerId: true } });
  if (!route) return NextResponse.json({ error: "제출처를 찾을 수 없어요." }, { status: 404 });
  const owners = await visibleOwnerIds(user);
  if (owners && !owners.includes(route.ownerId))
    return NextResponse.json({ error: "권한이 없어요." }, { status: 403 });

  const submittedBool = !!submitted;
  const submittedAt = submittedBool ? new Date() : null;

  const log = await prisma.monthlySubmissionLog.upsert({
    where: { yearMonth_submissionRouteId: { yearMonth, submissionRouteId } },
    create: {
      id: crypto.randomUUID(),
      yearMonth,
      submissionRouteId,
      submitted: submittedBool,
      submittedAt,
      memo: memo ?? null,
      updatedAt: new Date(),
    },
    update: {
      submitted: submittedBool,
      submittedAt,
      ...(memo !== undefined ? { memo: memo || null } : {}),
      updatedAt: new Date(),
    },
  });

  return NextResponse.json(log);
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!canManageSubmissionRoutes(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { yearMonth, submissionEntity, submitted } = await req.json();
  if (!yearMonth || !YM_RE.test(yearMonth))
    return NextResponse.json({ error: "yearMonth (YYYY-MM) 필요" }, { status: 400 });
  if (!submissionEntity)
    return NextResponse.json({ error: "submissionEntity 필요" }, { status: 400 });

  const owners = await visibleOwnerIds(user);
  const routes = await prisma.submissionRoute.findMany({
    where: { active: true, submissionEntity, ...(owners ? { ownerId: { in: owners } } : {}) },
    select: { id: true },
  });
  if (routes.length === 0)
    return NextResponse.json({ error: "해당 제출처에 등록된 거래처가 없어요." }, { status: 404 });

  const submittedBool = !!submitted;
  const submittedAt = submittedBool ? new Date() : null;
  const now = new Date();

  await prisma.$transaction(
    routes.map((r) =>
      prisma.monthlySubmissionLog.upsert({
        where: { yearMonth_submissionRouteId: { yearMonth, submissionRouteId: r.id } },
        create: {
          id: crypto.randomUUID(),
          yearMonth,
          submissionRouteId: r.id,
          submitted: submittedBool,
          submittedAt,
          updatedAt: now,
        },
        update: { submitted: submittedBool, submittedAt, updatedAt: now },
      })
    )
  );

  return NextResponse.json({ success: true, count: routes.length });
}
