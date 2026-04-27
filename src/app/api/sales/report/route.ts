import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildDailyReport, formatTelegramMessage, buildSheetRows, previousDayKstRange } from "@/lib/report";
import { sendTelegram } from "@/lib/telegram";
import { appendRows, SHEET_TABS, ensureTabExists } from "@/lib/sheets";

const DAILY_HEADERS = ["보고일","스토어","상품명","옵션","수량","매출","수수료","원가","물류비","입출고비","부자재비","기타비","총비용","이익"];

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { fromIso?: string; toIso?: string };
  const range = body.fromIso && body.toIso
    ? { fromIso: body.fromIso, toIso: body.toIso, reportDate: new Date(body.fromIso) }
    : previousDayKstRange();

  const summary = await buildDailyReport(range.fromIso, range.toIso, range.reportDate);
  const text = formatTelegramMessage(summary);
  const tg = await sendTelegram(text);

  const sheetRows = buildSheetRows(summary).slice(1);
  let sheet: Awaited<ReturnType<typeof appendRows>> = { ok: true, skipped: true };
  if (sheetRows.length > 0) {
    await ensureTabExists(SHEET_TABS.daily, DAILY_HEADERS);
    sheet = await appendRows(`${SHEET_TABS.daily}!A2`, sheetRows);
  }

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
