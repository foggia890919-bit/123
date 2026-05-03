import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

// GET /api/submission-routes/check
// 제출처별 사업자등록증 매칭 현황 반환
// Response: { entities: EntityStatus[] }
// EntityStatus: { submissionEntity, companyName, total, matched, missing: MissingItem[] }

interface MissingItem {
  clientName: string;
  companyName: string;
}

export async function GET() {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  // 활성 제출처 전체 조회
  const routes = await prisma.submissionRoute.findMany({
    where: { active: true },
    select: { clientName: true, companyName: true, submissionEntity: true },
    orderBy: [{ submissionEntity: "asc" }, { clientName: "asc" }],
  });

  if (routes.length === 0) {
    return NextResponse.json({ entities: [] });
  }

  // 문서 조회 소스 1: FilterRequest (최신, companyName 매칭)
  const clientNames = [...new Set(routes.map((r) => r.clientName))];
  const companyNames = [...new Set(routes.map((r) => r.companyName))];

  const filterRequests = await prisma.filterRequest.findMany({
    where: {
      clientName: { in: clientNames },
      companyName: { in: companyNames },
      OR: [{ bizFileKey: { not: null } }, { bizDocument: { not: null } }],
    },
    select: { clientName: true, companyName: true, bizFileKey: true, bizDocument: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // 문서 조회 소스 2: UserClient (clientName 매칭, 전체 사용자)
  const userClients = await prisma.userClient.findMany({
    where: {
      clientName: { in: clientNames },
      OR: [{ bizFileKey: { not: null } }, { bizDocument: { not: null } }],
    },
    select: { clientName: true, bizFileKey: true, bizDocument: true, bizFileName: true },
    distinct: ["clientName"],
  });

  // 문서 조회 소스 3: Client (글로벌)
  const globalClients = await prisma.client.findMany({
    where: {
      clientName: { in: clientNames },
      OR: [{ bizFileKey: { not: null } }, { bizDocument: { not: null } }],
    },
    select: { clientName: true, bizFileKey: true, bizDocument: true, bizFileName: true },
  });

  // 매핑 빌드: clientName+companyName → FilterRequest 있음
  const frKey = (cn: string, co: string) => `${cn}::${co}`;
  const frSet = new Set(filterRequests.map((f) => frKey(f.clientName, f.companyName)));
  const ucSet = new Set(userClients.map((u) => u.clientName));
  const gcSet = new Set(globalClients.map((c) => c.clientName));

  function hasDoc(clientName: string, companyName: string): boolean {
    return frSet.has(frKey(clientName, companyName)) || ucSet.has(clientName) || gcSet.has(clientName);
  }

  // 제출처별로 그룹핑
  type EntityGroup = {
    submissionEntity: string;
    companies: Set<string>;
    total: number;
    matched: number;
    missing: MissingItem[];
  };

  const entityMap = new Map<string, EntityGroup>();

  for (const r of routes) {
    const key = r.submissionEntity;
    if (!entityMap.has(key)) {
      entityMap.set(key, {
        submissionEntity: key,
        companies: new Set(),
        total: 0,
        matched: 0,
        missing: [],
      });
    }
    const g = entityMap.get(key)!;
    g.companies.add(r.companyName);
    g.total++;
    if (hasDoc(r.clientName, r.companyName)) {
      g.matched++;
    } else {
      g.missing.push({ clientName: r.clientName, companyName: r.companyName });
    }
  }

  const entities = Array.from(entityMap.values()).map((g) => ({
    submissionEntity: g.submissionEntity,
    companies: [...g.companies],
    total: g.total,
    matched: g.matched,
    missingCount: g.missing.length,
    missing: g.missing,
  }));

  // 제출처 미매핑: 사업자등록증이 있지만 SubmissionRoute에 등록 안 된 거래처×제약사
  const allDocsFr = await prisma.filterRequest.findMany({
    where: { OR: [{ bizFileKey: { not: null } }, { bizDocument: { not: null } }] },
    select: { clientName: true, companyName: true },
    distinct: ["clientName", "companyName"],
  });
  const routeKeySet = new Set(routes.map((r) => `${r.clientName}::${r.companyName}`));
  const unmappedMap = new Map<string, { clientName: string; companyName: string }>();
  for (const fr of allDocsFr) {
    const key = `${fr.clientName}::${fr.companyName}`;
    if (!routeKeySet.has(key) && !unmappedMap.has(key)) {
      unmappedMap.set(key, { clientName: fr.clientName, companyName: fr.companyName });
    }
  }
  const unmapped = Array.from(unmappedMap.values()).sort((a, b) =>
    a.clientName === b.clientName
      ? a.companyName.localeCompare(b.companyName)
      : a.clientName.localeCompare(b.clientName)
  );

  return NextResponse.json({ entities, unmapped });
}
