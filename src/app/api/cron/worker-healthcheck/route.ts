import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrService } from "@/lib/auth-guard";
import { sendTelegramMessage } from "@/lib/telegram";
import { sendAlimtalk, sendSms } from "@/lib/coolsms";

export const maxDuration = 30;

// 마지막 배치 후 N시간 초과 시 비정상 판정
const MAX_HOURS_SINCE_LAST_BATCH = 26; // 0/9시 cron이면 정상은 최대 9~13시간. 26h이면 1회 이상 누락.

interface HealthSnapshot {
  workerAlive: boolean;
  workerError: string | null;
  jobRunning: boolean;
  lastBatchAt: string | null;
  hoursSinceLastBatch: number | null;
  isStale: boolean;
}

// GET /api/cron/worker-healthcheck
// Vercel cron + admin/service 수동 호출.
// 워커 health + 최근 ScrapeJob 시각을 확인하고, 비정상 시 카카오/텔레그램 알림.
// ?dryRun=1 → 알림 없이 상태만 반환.
export async function GET(req: NextRequest) {
  const guard = await requireAdminOrService(req);
  if (guard instanceof NextResponse) return guard;

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  // 1) 워커 health 호출
  const workerUrl = process.env.WORKER_URL ?? "";
  let workerAlive = false;
  let workerError: string | null = null;
  let jobRunning = false;

  if (!workerUrl) {
    workerError = "WORKER_URL 미설정";
  } else {
    try {
      const r = await fetch(`${workerUrl.replace(/\/$/, "")}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!r.ok) {
        workerError = `HTTP ${r.status}`;
      } else {
        const data = await r.json().catch(() => null) as { ok?: boolean; jobRunning?: boolean } | null;
        workerAlive = !!data?.ok;
        jobRunning = !!data?.jobRunning;
        if (!workerAlive) workerError = "health 응답 ok=false";
      }
    } catch (err) {
      workerError = (err as Error).message ?? "네트워크 오류";
    }
  }

  // 2) 최근 배치 시각
  const lastJob = await prisma.scrapeJob.findFirst({
    where: { mode: "scheduled" },
    select: { startedAt: true, finishedAt: true, doneCodes: true, totalCodes: true, error: true },
    orderBy: { startedAt: "desc" },
  });
  const now = Date.now();
  let lastBatchAt: Date | null = null;
  let hoursSinceLastBatch: number | null = null;
  if (lastJob?.startedAt) {
    lastBatchAt = lastJob.startedAt;
    hoursSinceLastBatch = (now - lastBatchAt.getTime()) / (1000 * 60 * 60);
  }

  const isStale =
    !workerAlive ||
    (hoursSinceLastBatch !== null && hoursSinceLastBatch > MAX_HOURS_SINCE_LAST_BATCH);

  const snapshot: HealthSnapshot = {
    workerAlive,
    workerError,
    jobRunning,
    lastBatchAt: lastBatchAt?.toISOString() ?? null,
    hoursSinceLastBatch: hoursSinceLastBatch !== null ? Math.round(hoursSinceLastBatch * 10) / 10 : null,
    isStale,
  };

  // 3) 비정상 시 알림 발송
  const alerts: string[] = [];
  if (isStale && !dryRun) {
    const reasons: string[] = [];
    if (!workerAlive) reasons.push(`워커 응답 없음 (${workerError ?? "?"})`);
    if (hoursSinceLastBatch !== null && hoursSinceLastBatch > MAX_HOURS_SINCE_LAST_BATCH) {
      reasons.push(`마지막 배치 ${Math.floor(hoursSinceLastBatch)}시간 전`);
    }
    if (lastJob?.error) reasons.push(`마지막 에러: ${lastJob.error.slice(0, 200)}`);
    const message =
      `🚨 KMD 재고 워커 비정상\n` +
      reasons.map((r) => `• ${r}`).join("\n") +
      (lastBatchAt ? `\n\n마지막 배치: ${lastBatchAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` : "") +
      (lastJob ? `\nwritten: ${lastJob.doneCodes ?? "?"} / total: ${lastJob.totalCodes ?? "?"}` : "");

    // Telegram (TELEGRAM_CHAT_ID_BIZ 환경변수 자동 사용)
    try {
      const sent = await sendTelegramMessage(message);
      if (sent.ok) alerts.push("telegram");
      else alerts.push(`telegram_failed: ${sent.error ?? "?"}`);
    } catch (err) {
      alerts.push(`telegram_failed: ${(err as Error).message}`);
    }

    // 카카오 알림톡 (관리자 전화번호) — 템플릿 ID 없으면 SMS fallback
    const adminPhone = process.env.ADMIN_ALERT_PHONE;
    if (adminPhone) {
      try {
        const pfId = process.env.KAKAO_PF_ID;
        const templateId = process.env.KAKAO_TEMPLATE_WORKER_DOWN;
        if (pfId && templateId) {
          await sendAlimtalk(
            adminPhone,
            { pfId, templateId, variables: { "#{내용}": message } },
            message,
          );
          alerts.push("alimtalk");
        } else {
          await sendSms(adminPhone, message.slice(0, 90));
          alerts.push("sms_fallback");
        }
      } catch (err) {
        alerts.push(`kakao_failed: ${(err as Error).message}`);
      }
    }
  }

  return NextResponse.json({ ...snapshot, alerts, dryRun });
}
