import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

// GET /api/filter-mapping/suggestions?type=client&q=...
// GET /api/filter-mapping/suggestions?type=company&q=...
// GET /api/filter-mapping/suggestions?type=dealer&q=...

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const type = req.nextUrl.searchParams.get("type");
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  if (type === "client") {
    // 숫자/하이픈만 → 사업자번호 검색, 그 외 → 거래처명 검색
    const stripped = q.replace(/\D/g, "");
    const isDigits = stripped.length > 0 && q.replace(/-/g, "") === stripped;

    const [globalClients, userClients] = await Promise.all([
      // 전역 Client 풀
      prisma.client.findMany({
        where: q
          ? isDigits
            ? { bizNumber: { contains: stripped } }
            : { clientName: { contains: q, mode: "insensitive" } }
          : {},
        select: { clientName: true, bizNumber: true },
        orderBy: { clientName: "asc" },
        take: 20,
      }),
      // UserClient (기존 등록 데이터 하위호환)
      prisma.userClient.findMany({
        where: q
          ? isDigits
            ? { bizNumber: { contains: stripped } }
            : { clientName: { contains: q, mode: "insensitive" } }
          : {},
        select: { clientName: true, bizNumber: true },
        distinct: ["bizNumber"],
        orderBy: { clientName: "asc" },
        take: 20,
      }),
    ]);

    // bizNumber 기준 중복 제거 (전역 풀 우선)
    const seen = new Set<string>();
    const merged: { clientName: string; bizNumber: string }[] = [];
    for (const c of [...globalClients, ...userClients]) {
      const key = c.bizNumber.replace(/\D/g, "");
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(c);
      }
    }
    return NextResponse.json(
      merged.sort((a, b) => a.clientName.localeCompare(b.clientName)).slice(0, 20)
    );
  }

  if (type === "company") {
    // MemberCompanyRate에서 제약사명 조회
    const companies = await prisma.memberCompanyRate.findMany({
      where: q ? { companyName: { contains: q, mode: "insensitive" } } : {},
      select: { companyName: true },
      distinct: ["companyName"],
      orderBy: { companyName: "asc" },
      take: 20,
    });
    // FilterRequest에서도 추가로 수집
    const fromRequests = await prisma.filterRequest.findMany({
      where: q ? { companyName: { contains: q, mode: "insensitive" } } : {},
      select: { companyName: true },
      distinct: ["companyName"],
      orderBy: { companyName: "asc" },
      take: 20,
    });
    const allNames = [
      ...new Set([
        ...companies.map((c) => c.companyName),
        ...fromRequests.map((r) => r.companyName),
      ]),
    ]
      .filter((n) => !q || n.toLowerCase().includes(q.toLowerCase()))
      .sort()
      .slice(0, 20);
    return NextResponse.json(allNames.map((companyName) => ({ companyName })));
  }

  if (type === "dealer") {
    // 법인·딜러 등록관리에서 dealerType이 설정된 거래처
    const dealers = await prisma.userClient.findMany({
      where: {
        dealerType: { not: null },
        ...(q
          ? /^\d+$/.test(q)
            ? { bizNumber: { contains: q } }
            : { clientName: { contains: q, mode: "insensitive" } }
          : {}),
      },
      select: { clientName: true, bizNumber: true, dealerType: true },
      distinct: ["clientName"],
      orderBy: { clientName: "asc" },
      take: 20,
    });
    return NextResponse.json(dealers);
  }

  return NextResponse.json({ error: "type 파라미터가 필요합니다 (client | company | dealer)" }, { status: 400 });
}
