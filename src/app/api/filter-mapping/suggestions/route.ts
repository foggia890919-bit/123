import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

// GET /api/filter-mapping/suggestions?type=client&q=...
// GET /api/filter-mapping/suggestions?type=company&q=...
// GET /api/filter-mapping/suggestions?type=dealer&q=...

// DB에 하이픈 포함/미포함 혼재하므로 두 형태 모두 OR 검색
function bizWhere(stripped: string) {
  const fmt = stripped.length <= 3 ? stripped
    : stripped.length <= 5 ? `${stripped.slice(0, 3)}-${stripped.slice(3)}`
    : `${stripped.slice(0, 3)}-${stripped.slice(3, 5)}-${stripped.slice(5)}`;
  if (fmt === stripped) return { bizNumber: { contains: stripped } };
  return { OR: [{ bizNumber: { contains: stripped } }, { bizNumber: { contains: fmt } }] };
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const type = req.nextUrl.searchParams.get("type");
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  if (type === "client") {
    const stripped = q.replace(/\D/g, "");
    const isDigits = stripped.length > 0 && q.replace(/-/g, "") === stripped;

    const nameOrBizWhere = q
      ? isDigits
        ? bizWhere(stripped)
        : { clientName: { contains: q, mode: "insensitive" as const } }
      : {};

    const globalClients = await prisma.client.findMany({
      where: nameOrBizWhere,
      select: { clientName: true, bizNumber: true },
      orderBy: { clientName: "asc" },
      take: 20,
    });

    let hospitalClients: { clientName: string; bizNumber: string }[] = [];
    try {
      hospitalClients = await prisma.userClient.findMany({
        where: { dealerType: null, ...nameOrBizWhere },
        select: { clientName: true, bizNumber: true },
        distinct: ["bizNumber"],
        orderBy: { clientName: "asc" },
        take: 20,
      });
    } catch {
      hospitalClients = await prisma.userClient.findMany({
        where: nameOrBizWhere,
        select: { clientName: true, bizNumber: true },
        distinct: ["bizNumber"],
        orderBy: { clientName: "asc" },
        take: 20,
      });
    }

    const seen = new Set<string>();
    const merged: { clientName: string; bizNumber: string }[] = [];
    for (const c of [...globalClients, ...hospitalClients]) {
      const key = c.bizNumber.replace(/\D/g, "");
      if (!seen.has(key)) { seen.add(key); merged.push(c); }
    }
    return NextResponse.json(
      merged.sort((a, b) => a.clientName.localeCompare(b.clientName)).slice(0, 20)
    );
  }

  if (type === "company") {
    const all = req.nextUrl.searchParams.get("all") === "true";
    const limit = all ? 5000 : 20;
    const companies = await prisma.memberCompanyRate.findMany({
      where: q ? { companyName: { contains: q, mode: "insensitive" } } : {},
      select: { companyName: true },
      distinct: ["companyName"],
      orderBy: { companyName: "asc" },
      take: limit,
    });
    const fromRequests = await prisma.filterRequest.findMany({
      where: q ? { companyName: { contains: q, mode: "insensitive" } } : {},
      select: { companyName: true },
      distinct: ["companyName"],
      orderBy: { companyName: "asc" },
      take: limit,
    });
    const allNames = [
      ...new Set([
        ...companies.map((c) => c.companyName),
        ...fromRequests.map((r) => r.companyName),
      ]),
    ]
      .filter((n) => !q || n.toLowerCase().includes(q.toLowerCase()))
      .sort()
      .slice(0, limit);
    return NextResponse.json(allNames.map((companyName) => ({ companyName })));
  }

  if (type === "dealer") {
    const stripped = q.replace(/\D/g, "");
    const isDigits = stripped.length > 0 && q.replace(/-/g, "") === stripped;
    const where = {
      dealerType: { not: null },
      ...(q
        ? isDigits
          ? bizWhere(stripped)
          : { clientName: { contains: q, mode: "insensitive" as const } }
        : {}),
    };
    let dealers;
    try {
      dealers = await prisma.userClient.findMany({
        where,
        select: { clientName: true, bizNumber: true, dealerType: true, managerName: true, managerPhone: true, memo: true },
        distinct: ["clientName"],
        orderBy: { clientName: "asc" },
        take: 20,
      });
    } catch {
      dealers = await prisma.userClient.findMany({
        where,
        select: { clientName: true, bizNumber: true, dealerType: true },
        distinct: ["clientName"],
        orderBy: { clientName: "asc" },
        take: 20,
      });
    }
    return NextResponse.json(dealers);
  }

  return NextResponse.json({ error: "type 파라미터가 필요합니다 (client | company | dealer)" }, { status: 400 });
}
