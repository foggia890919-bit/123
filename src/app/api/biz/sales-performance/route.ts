import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

interface FinalDrug {
  quantity?: string;
  unitPrice?: number | null;
}

export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if (isNextResponse(session)) return session;

  const year = parseInt(
    req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  );

  const users = await prisma.user.findMany({
    where: { role: "SALES_REP", approved: true },
    select: {
      id: true,
      name: true,
      email: true,
      salesCode: true,
      prescriptionReports: {
        where: { year },
        select: { month: true, totalFee: true, ocrData: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const monthly12 = () => Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    count: 0,
    prescriptionTotal: 0,
    totalFee: 0,
  }));

  const result = users.map((u) => {
    const months = monthly12();
    for (const r of u.prescriptionReports) {
      const m = months[r.month - 1];
      m.count++;
      m.totalFee += r.totalFee ?? 0;
      try {
        const ocd = r.ocrData as Record<string, unknown> | null;
        const drugs: FinalDrug[] = (ocd?.finalDrugs ?? ocd?.aiDrugs ?? []) as FinalDrug[];
        for (const d of drugs) {
          const qty = parseFloat(d.quantity ?? "0") || 0;
          m.prescriptionTotal += qty * (d.unitPrice ?? 0);
        }
      } catch { /* skip */ }
    }
    const totals = months.reduce(
      (acc, m) => ({
        count: acc.count + m.count,
        prescriptionTotal: acc.prescriptionTotal + m.prescriptionTotal,
        totalFee: acc.totalFee + m.totalFee,
      }),
      { count: 0, prescriptionTotal: 0, totalFee: 0 }
    );
    return { id: u.id, name: u.name, email: u.email, salesCode: u.salesCode, months, totals };
  });

  const availableYears = await prisma.prescriptionReport.findMany({
    select: { year: true },
    distinct: ["year"],
    orderBy: { year: "desc" },
  });

  return NextResponse.json({ year, users: result, availableYears: availableYears.map((r) => r.year) });
}
