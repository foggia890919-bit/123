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
    // 전역 Client 풀에서 검색 (숫자→사업자번호, 문자→거래처명)
    const isDigits = /^\d+$/.test(q);
    const clients = await prisma.client.findMany({
      where: q
        ? isDigits
          ? { bizNumber: { contains: q } }
          : { clientName: { contains: q, mode: "insensitive" } }
        : {},
      select: { clientName: true, bizNumber: true },
      orderBy: { clientName: "asc" },
      take: 20,
    });
    return NextResponse.json(clients);
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
