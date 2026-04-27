import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildDailyReport, previousDayKstRange } from "@/lib/report";
import { getSheetUrl } from "@/lib/sheets";

export async function GET() {
  const stores = await prisma.naverStore.findMany({ orderBy: { code: "asc" } });
  const { fromIso, toIso, reportDate } = previousDayKstRange();
  const report = await buildDailyReport(fromIso, toIso, reportDate);
  return NextResponse.json({
    stores: stores.map(({ id, code, bizName, storeName, enabled }) => ({
      id,
      code,
      bizName,
      storeName,
      enabled,
    })),
    report: {
      reportDate: report.reportDate.toISOString().slice(0, 10),
      totals: report.totals,
      byStore: report.byStore,
      byKeyword: report.byKeyword,
      details: report.details.slice(0, 50),
    },
    sheetUrl: getSheetUrl(),
  });
}
