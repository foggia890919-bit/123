import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncStoreOrders } from "@/lib/naver/sync";
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

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = previousDayKstRange();

  const stores = await prisma.naverStore.findMany({ where: { enabled: true } });
  const syncResults = [];
  for (const s of stores) {
    try {
      const r = await syncStoreOrders(s.id, range.fromIso, range.toIso);
      syncResults.push(r);
    } catch (err) {
      syncResults.push({ store: s.code, orders: 0, items: 0, errors: [err instanceof Error ? err.message : String(err)] });
    }
  }

  const summary = await buildDailyReport(range.fromIso, range.toIso, range.reportDate);
  const text = formatTelegramMessage(summary);
  const tg = await sendTelegram(text);

  const detailRows = buildDetailRows(summary);
  const keywordRows = buildKeywordRows(summary);
  let sheetDetail: Awaited<ReturnType<typeof appendRows>> = { ok: true, skipped: true };
  let sheetKeyword: Awaited<ReturnType<typeof appendRows>> = { ok: true, skipped: true };
  if (detailRows.length > 0) {
    await ensureTabExists(SHEET_TABS.daily, DAILY_DETAIL_HEADERS);
    sheetDetail = await appendRows(`${SHEET_TABS.daily}!A2`, detailRows);
  }
  if (keywordRows.length > 0) {
    await ensureTabExists("키워드집계", DAILY_KEYWORD_HEADERS);
    sheetKeyword = await appendRows("키워드집계!A2", keywordRows);
  }

  await prisma.dailyReportLog.upsert({
    where: { reportDate: summary.reportDate },
    create: { reportDate: summary.reportDate, channel: "telegram", ok: tg.ok, message: tg.error ?? null },
    update: { sentAt: new Date(), channel: "telegram", ok: tg.ok, message: tg.error ?? null },
  });

  return NextResponse.json({
    ok: true,
    range,
    sync: syncResults,
    telegram: tg,
    sheet: { detail: sheetDetail, keyword: sheetKeyword },
    totals: summary.totals,
    byKeyword: summary.byKeyword,
  });
}
