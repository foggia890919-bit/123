import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const year = parseInt(req.nextUrl.searchParams.get("year") ?? "0");
  const month = parseInt(req.nextUrl.searchParams.get("month") ?? "0");
  if (!year || !month) return NextResponse.json([], { status: 200 });

  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;

  const userClients = await prisma.userClient.findMany({
    where: { userId: session.id },
    select: { id: true, clientName: true, bizNumber: true },
    orderBy: { clientName: "asc" },
  });

  if (!userClients.length) return NextResponse.json([]);

  const bizNumbers = userClients.map((c) => c.bizNumber).filter(Boolean) as string[];

  const [filters, uploads] = await Promise.all([
    prisma.filterRequest.findMany({
      where: { bizNumber: { in: bizNumbers }, status: "APPROVED" },
      select: { bizNumber: true, companyName: true },
      distinct: ["bizNumber", "companyName"],
      orderBy: { companyName: "asc" },
    }),
    prisma.statImage.findMany({
      where: {
        userId: session.id,
        OR: [
          { year, month },
          { year: prevYear, month: prevMonth },
        ],
      },
      select: { clientId: true, year: true, month: true },
      distinct: ["clientId", "year", "month"],
    }),
  ]);

  const result = userClients.flatMap((client) => {
    const clientCompanies = filters
      .filter((f) => f.bizNumber === client.bizNumber)
      .map((f) => f.companyName);

    const companies = clientCompanies.length ? clientCompanies : ["(미매핑)"];
    const curUploaded = uploads.some((u) => u.clientId === client.id && u.year === year && u.month === month);
    const prevUploaded = uploads.some((u) => u.clientId === client.id && u.year === prevYear && u.month === prevMonth);

    return companies.map((companyName) => ({
      clientId: client.id,
      clientName: client.clientName,
      companyName,
      prevMonthUploaded: prevUploaded,
      curMonthUploaded: curUploaded,
    }));
  });

  return NextResponse.json(result);
}
