import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, canManageSubmissionRoutes } from "@/lib/auth-guard";
import { getViewableUserIds } from "@/lib/hierarchy";
import { companyNameKey } from "@/lib/company-name";

// GET /api/stats/submission-status
// 통계 제출현황 — 법인(submissionEntity) > 거래처(clientName) > 제약사(companyName) 계층 +
// 최근 3개월 월별 제출여부(하이브리드 판정).
//
// 월별 제출여부 = (a) MonthlySubmissionLog 수동 체크(source: "manual")
//              OR (b) 자동 감지(source: "auto"): 그 달 해당 ownerId 의 PrescriptionReport 가
//                     clientName(hospitalName 또는 clientId 조인) × companyName(companyNameKey)
//                     으로 1건 이상 존재.
//   PrescriptionReport.companyName 이 비면 미매칭 처리(ocrData 조회 안 함 — 비용).
//   자동 감지는 3개월 범위를 groupBy 로 한 번에 집계(월별 반복 쿼리 금지).
//
// 권한/가시성은 submission-routes GET 과 동일 규칙.

async function visibleOwnerIds(user: { id: string; role: string }): Promise<string[] | null> {
  if (user.role === "ADMIN") return null;
  const [viewable, admins] = await Promise.all([
    getViewableUserIds(user.id),
    prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } }),
  ]);
  return [...new Set([...viewable, ...admins.map((a) => a.id)])];
}

// 최근 count 개월 "YYYY-MM" (오래된 → 최신 순).
function recentYearMonths(count = 3): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

type Cell = { submitted: boolean; source: "manual" | "auto" | null; photoCount?: number };

export async function GET(_req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!canManageSubmissionRoutes(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const months = recentYearMonths(3);
  const monthPairs = months.map((ym) => {
    const [y, m] = ym.split("-").map(Number);
    return { year: y, month: m };
  });
  const owners = await visibleOwnerIds(user);

  const routes = await prisma.submissionRoute.findMany({
    where: { active: true, ...(owners ? { ownerId: { in: owners } } : {}) },
    orderBy: [{ submissionEntity: "asc" }, { clientName: "asc" }, { companyName: "asc" }],
    select: {
      id: true,
      ownerId: true,
      clientName: true,
      companyName: true,
      submissionEntity: true,
      parentUserId: true,
      parentUser: { select: { id: true, name: true, email: true } },
    },
  });

  // ── (a) 수동 체크 ──
  const routeIds = routes.map((r) => r.id);
  const logs = routeIds.length
    ? await prisma.monthlySubmissionLog.findMany({
        where: { submissionRouteId: { in: routeIds }, yearMonth: { in: months } },
        select: { submissionRouteId: true, yearMonth: true, submitted: true },
      })
    : [];
  const manualMap = new Map<string, boolean>();
  for (const l of logs) manualMap.set(`${l.submissionRouteId}|${l.yearMonth}`, l.submitted);

  // ── (b) 자동 감지 — 3개월 범위 groupBy 한 번 ──
  // key: `${userId}|${ym}|${clientKey}|${companyKey}` → 사진 수 합계.
  const ownerIds = [...new Set(routes.map((r) => r.ownerId))];
  const autoMap = new Map<string, number>();
  if (ownerIds.length > 0) {
    const grouped = await prisma.prescriptionReport.groupBy({
      by: ["userId", "clientId", "hospitalName", "companyName", "year", "month"],
      where: { userId: { in: ownerIds }, OR: monthPairs },
      _count: { _all: true },
    });

    // clientId → clientName 배치 조회 (거래처명 매칭용)
    const clientIds = [...new Set(grouped.map((g) => g.clientId).filter((v): v is string => !!v))];
    const clientRows = clientIds.length
      ? await prisma.userClient.findMany({ where: { id: { in: clientIds } }, select: { id: true, clientName: true } })
      : [];
    const clientNameById = new Map(clientRows.map((c) => [c.id, c.clientName]));

    for (const g of grouped) {
      const companyKey = companyNameKey(g.companyName || "");
      if (!companyKey) continue; // companyName 비면 미매칭 처리
      const ym = `${g.year}-${String(g.month).padStart(2, "0")}`;
      const count = g._count._all;
      // hospitalName + clientId 조인 clientName 둘 다 매칭 키로 등록 (어느 쪽이든 route.clientName 과 맞으면 감지)
      const clientNames = new Set<string>();
      if (g.hospitalName) clientNames.add(g.hospitalName);
      const joined = g.clientId ? clientNameById.get(g.clientId) : null;
      if (joined) clientNames.add(joined);
      for (const cn of clientNames) {
        const ck = companyNameKey(cn);
        if (!ck) continue;
        const key = `${g.userId}|${ym}|${ck}|${companyKey}`;
        autoMap.set(key, (autoMap.get(key) ?? 0) + count);
      }
    }
  }

  const currentMonth = months[months.length - 1];
  let submittedThisMonth = 0;

  const list = routes.map((r) => {
    const routeClientKey = companyNameKey(r.clientName);
    const routeCompanyKey = companyNameKey(r.companyName);
    const cells: Record<string, Cell> = {};
    for (const ym of months) {
      const manual = manualMap.get(`${r.id}|${ym}`) === true;
      const autoCount = autoMap.get(`${r.ownerId}|${ym}|${routeClientKey}|${routeCompanyKey}`) ?? 0;
      let cell: Cell;
      if (manual) cell = { submitted: true, source: "manual" };
      else if (autoCount > 0) cell = { submitted: true, source: "auto", photoCount: autoCount };
      else cell = { submitted: false, source: null };
      cells[ym] = cell;
      if (ym === currentMonth && cell.submitted) submittedThisMonth++;
    }
    return {
      id: r.id,
      submissionEntity: r.submissionEntity,
      clientName: r.clientName,
      companyName: r.companyName,
      parentUserName: r.parentUser?.name || r.parentUser?.email || null,
      directInput: !r.parentUserId, // 자유입력(회원 미연결) 제출법인
      cells,
    };
  });

  return NextResponse.json({
    months,
    currentMonth,
    totalMappings: list.length,
    submittedThisMonth,
    routes: list,
  });
}
