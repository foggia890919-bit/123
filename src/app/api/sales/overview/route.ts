import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildDailyReport, previousDayKstRange } from "@/lib/report";
import { getWorkspaceSheetUrl } from "@/lib/sheets";
import { requireWorkspace } from "@/lib/workspace";

export async function GET() {
  try {
    const { workspace } = await requireWorkspace();
    const stores = await prisma.naverStore.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { code: "asc" },
    });
    const { fromIso, toIso, reportDate } = previousDayKstRange();
    const report = await buildDailyReport(fromIso, toIso, reportDate, workspace.id);
    return NextResponse.json({
      workspace: { id: workspace.id, name: workspace.name },
      stores: stores.map(({ id, code, bizName, storeName, enabled }) => ({ id, code, bizName, storeName, enabled })),
      report: {
        reportDate: report.reportDate.toISOString().slice(0, 10),
        totals: report.totals,
        byStore: report.byStore,
        byKeyword: report.byKeyword,
        details: report.details.slice(0, 50),
      },
      sheetUrl: getWorkspaceSheetUrl(workspace.googleSheetsId),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
