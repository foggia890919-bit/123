import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildDailyReport,
  formatTelegramMessage,
  buildDetailRows,
  buildKeywordRows,
  DAILY_DETAIL_HEADERS,
  DAILY_KEYWORD_HEADERS,
  previousDayKstRange,
} from "@/lib/report";
import { sendTelegram } from "@/lib/telegram";
import { appendRows, SHEET_TABS, ensureTabExists } from "@/lib/sheets";
import { requireWorkspace } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  try {
    const { workspace } = await requireWorkspace();
    const body = (await req.json().catch(() => ({}))) as { fromIso?: string; toIso?: string };
    const range = body.fromIso && body.toIso
      ? { fromIso: body.fromIso, toIso: body.toIso, reportDate: new Date(body.fromIso) }
      : previousDayKstRange();

    const summary = await buildDailyReport(range.fromIso, range.toIso, range.reportDate, workspace.id);
    const text = formatTelegramMessage(summary);
    const tg = await sendTelegram(text, workspace);

    const detailRows = buildDetailRows(summary);
    const keywordRows = buildKeywordRows(summary);
    let sheetDetail: Awaited<ReturnType<typeof appendRows>> = { ok: true, skipped: true };
    let sheetKeyword: Awaited<ReturnType<typeof appendRows>> = { ok: true, skipped: true };
    if (detailRows.length > 0) {
      await ensureTabExists(SHEET_TABS.daily, DAILY_DETAIL_HEADERS, workspace);
      sheetDetail = await appendRows(`${SHEET_TABS.daily}!A2`, detailRows, workspace);
    }
    if (keywordRows.length > 0) {
      await ensureTabExists("키워드집계", DAILY_KEYWORD_HEADERS, workspace);
      sheetKeyword = await appendRows("키워드집계!A2", keywordRows, workspace);
    }

    await prisma.dailyReportLog.upsert({
      where: { workspaceId_reportDate: { workspaceId: workspace.id, reportDate: summary.reportDate } },
      create: {
        workspaceId: workspace.id,
        reportDate: summary.reportDate,
        channel: "telegram",
        ok: tg.ok,
        message: tg.error ?? null,
      },
      update: { sentAt: new Date(), channel: "telegram", ok: tg.ok, message: tg.error ?? null },
    });

    return NextResponse.json({
      ok: true,
      telegram: tg,
      sheet: { detail: sheetDetail, keyword: sheetKeyword },
      totals: summary.totals,
      byKeyword: summary.byKeyword,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
