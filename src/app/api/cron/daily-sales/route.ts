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

/**
 * 오늘 KST 자정 기준 reportTime 이 이미 지났는지.
 * cron 트리거가 GitHub Actions/Vercel 모두 정확하지 않을 수 있어 「지났다」 만 체크.
 * 중복 발송은 DailyReportLog 의 unique(workspaceId, reportDate) 로 방지.
 */
function isReportTimePassed(reportTimeKst: string): boolean {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const hh = kst.getUTCHours();
  const mm = kst.getUTCMinutes();
  const [rh, rm] = reportTimeKst.split(":").map((s) => parseInt(s, 10));
  const cur = hh * 60 + mm;
  const target = (rh || 9) * 60 + (rm || 0);
  return cur >= target;
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
    if (!force) {
      if (!isReportTimePassed(ws.reportTime)) continue;
      const existing = await prisma.dailyReportLog.findUnique({
        where: { workspaceId_reportDate: { workspaceId: ws.id, reportDate: range.reportDate } },
      });
      if (existing?.ok) continue;
    }

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
