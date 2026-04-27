import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildDailyReport, formatTelegramMessage, buildSheetRows, previousDayKstRange } from "@/lib/report";
import { sendTelegram } from "@/lib/telegram";
import { appendRows } from "@/lib/sheets";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { fromIso?: string; toIso?: string };
  const range = body.fromIso && body.toIso
    ? { fromIso: body.fromIso, toIso: body.toIso, reportDate: new Date(body.fromIso) }
    : previousDayKstRange();

  const summary = await buildDailyReport(range.fromIso, range.toIso, range.reportDate);
  const text = formatTelegramMessage(summary);
  const tg = await sendTelegram(text);

  const sheetRows = buildSheetRows(summary).slice(1);
  const sheet = sheetRows.length > 0 ? await appendRows("일일보고!A1", sheetRows) : { ok: true, skipped: true };

  await prisma.dailyReportLog.upsert({
    where: { reportDate: summary.reportDate },
    create: {
      reportDate: summary.reportDate,
      channel: "telegram",
      ok: tg.ok,
      message: tg.error ?? null,
    },
    update: {
      sentAt: new Date(),
      channel: "telegram",
      ok: tg.ok,
      message: tg.error ?? null,
    },
  });

  return NextResponse.json({ ok: true, telegram: tg, sheet, totals: summary.totals });
}
