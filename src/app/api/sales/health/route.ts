import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";
import { getAccessToken } from "@/lib/naver/client";
import { decrypt } from "@/lib/crypto";
import { sendTelegram } from "@/lib/telegram";

export async function GET() {
  try {
    const { workspace } = await requireWorkspace();

    const env = {
      DATABASE_URL: !!process.env.DATABASE_URL,
      NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
      ENCRYPTION_KEY: !!process.env.ENCRYPTION_KEY,
      CRON_SECRET: !!process.env.CRON_SECRET,
      TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
      GOOGLE_SHEETS_ID: !!process.env.GOOGLE_SHEETS_ID,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    };

    const ws = {
      hasTelegram: !!(workspace.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN),
      hasSheet: !!((workspace.googleSheetsId && workspace.googleServiceAccountEmail && workspace.googleServiceAccountKey) ||
        (process.env.GOOGLE_SHEETS_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)),
      reportTime: workspace.reportTime,
    };

    const stores = await prisma.naverStore.findMany({ where: { workspaceId: workspace.id }, select: { id: true, storeName: true, code: true, clientId: true, clientSecret: true, enabled: true, lastSyncedAt: true } });
    const storeChecks = await Promise.all(stores.map(async (s) => {
      let ok = false;
      let error: string | null = null;
      try {
        await getAccessToken(s.clientId, decrypt(s.clientSecret));
        ok = true;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      return { id: s.id, storeName: s.storeName, code: s.code, enabled: s.enabled, naverOk: ok, naverError: error, lastSyncedAt: s.lastSyncedAt };
    }));

    // 최근 보고/잡 현황
    const [recentReport, runningJobs, recentItem] = await Promise.all([
      prisma.dailyReportLog.findFirst({ where: { workspaceId: workspace.id }, orderBy: { sentAt: "desc" } }),
      prisma.backfillJob.count({ where: { workspaceId: workspace.id, status: { in: ["PENDING", "RUNNING"] } } }),
      prisma.naverOrderItem.findFirst({
        where: { order: { store: { workspaceId: workspace.id } } },
        orderBy: { paymentDate: "desc" },
        select: { paymentDate: true },
      }),
    ]);

    return NextResponse.json({
      env,
      workspace: ws,
      stores: storeChecks,
      recentReport,
      runningBackfillJobs: runningJobs,
      latestOrderPaymentDate: recentItem?.paymentDate ?? null,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function POST() {
  // 텔레그램 즉석 검증
  try {
    const { workspace } = await requireWorkspace();
    const r = await sendTelegram(`헬스체크 — ${workspace.name} ${new Date().toLocaleString("ko-KR")}`, workspace);
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
