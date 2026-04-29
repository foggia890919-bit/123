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

function shouldRunNow(reportTimeKst: string): boolean {
  // KST 현재 시각의 HH:mm 이 reportTime 과 같은지 (cron 트리거 시각이 정확히 일치하지 않을 수 있어 ±10분 허용)
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hh = kst.getUTCHours();
  const mm = kst.getUTCMinutes();
  const [rh, rm] = reportTimeKst.split(":").map((s) => parseInt(s, 10));
  const cur = hh * 60 + mm;
  const target = (rh || 8) * 60 + (rm || 0);
  return Math.abs(cur - target) <= 10;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  const range = previousDayKstRange();

  const workspaces = await prisma.workspace.findMany({ where: { enabled: true } });
  const results: unknown[] = [];

  for (const ws of workspaces) {
    if (!force && !shouldRunNow(ws.reportTime)) continue;

    const stores = await prisma.naverStore.findMany({ where: { workspaceId: ws.id, enabled: true } });
    const syncResults = [];
    for (const s of stores) {
      try {
        const r = await syncStoreOrders(s.id, range.fromIso, range.toIso);
        syncResults.push(r);
      } catch (err) {
        syncResults.push({
          store: s.code,
          orders: 0,
          items: 0,
          errors: [err instanceof Error ? err.message : String(err)],
        });
      }
    }

    const summary = await buildDailyReport(range.fromIso, range.toIso, range.reportDate, ws.id);
    const text = formatTelegramMessage(summary);
    const tg = await sendTelegram(text, ws);

    const detailRows = buildDetailRows(summary);
    const keywordRows = buildKeywordRows(summary);
    let sheetDetail: Awaited<ReturnType<typeof appendRows>> = { ok: true, skipped: true };
    let sheetKeyword: Awaited<ReturnType<typeof appendRows>> = { ok: true, skipped: true };
    if (detailRows.length > 0) {
      await ensureTabExists(SHEET_TABS.daily, DAILY_DETAIL_HEADERS, ws);
      sheetDetail = await appendRows(`${SHEET_TABS.daily}!A2`, detailRows, ws);
    }
    if (keywordRows.length > 0) {
      await ensureTabExists("키워드집계", DAILY_KEYWORD_HEADERS, ws);
      sheetKeyword = await appendRows("키워드집계!A2", keywordRows, ws);
    }

    await prisma.dailyReportLog.upsert({
      where: { workspaceId_reportDate: { workspaceId: ws.id, reportDate: summary.reportDate } },
      create: {
        workspaceId: ws.id,
        reportDate: summary.reportDate,
        channel: "telegram",
        ok: tg.ok,
        message: tg.error ?? null,
      },
      update: { sentAt: new Date(), channel: "telegram", ok: tg.ok, message: tg.error ?? null },
    });

    results.push({
      workspace: ws.name,
      sync: syncResults,
      telegram: tg,
      sheet: { detail: sheetDetail, keyword: sheetKeyword },
      totals: summary.totals,
    });
  }

  return NextResponse.json({ ok: true, range, count: results.length, results });
}
