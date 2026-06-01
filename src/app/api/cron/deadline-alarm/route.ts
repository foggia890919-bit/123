import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAlimtalk } from "@/lib/coolsms";
import { normalizeCompanyName } from "@/lib/company-name";
import { requireAdminOrService } from "@/lib/auth-guard";

export const maxDuration = 60;

// KST 기준 N일 후 마감일 알림. days 기본값 [2,1,0]
// GET /api/cron/deadline-alarm  (cron 자동 호출)
// GET /api/cron/deadline-alarm?days=2  (특정 D-N만)
// GET /api/cron/deadline-alarm?dryRun=1 (발송 안 하고 대상만 반환)
export async function GET(req: NextRequest) {
  const guard = await requireAdminOrService(req);
  if (guard instanceof NextResponse) return guard;

  const sp = req.nextUrl.searchParams;
  const dryRun = sp.get("dryRun") === "1";
  const daysParam = sp.get("days");
  const targetDays = daysParam ? [Number(daysParam)] : [2, 1, 0];

  // KST 자정 기준 N일 후 범위
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()));

  const sent: Array<{ to: string; companyName: string; deadline: string; days: number }> = [];
  const skipped: string[] = [];

  for (const d of targetDays) {
    const dayStart = new Date(today.getTime() + d * 24 * 60 * 60 * 1000);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const deadlines = await prisma.companyDeadline.findMany({
      where: { deadline: { gte: dayStart, lt: dayEnd } },
      select: { companyName: true, yearMonth: true, deadline: true },
    });
    if (deadlines.length === 0) continue;

    const companyNames = deadlines.map((x) => x.companyName);

    // 해당 제약사 거래처를 가진 영업사원 찾기 — SubmissionRoute로 연결
    const routes = await prisma.submissionRoute.findMany({
      where: { companyName: { in: companyNames }, active: true },
      select: {
        ownerId: true,
        clientName: true,
        companyName: true,
        owner: { select: { name: true, phone: true } },
      },
    });

    const grouped = new Map<string, { phone: string; name: string; items: Array<{ clientName: string; companyName: string; deadline: Date }> }>();
    for (const r of routes) {
      const normalized = normalizeCompanyName(r.companyName);
      const matched = deadlines.find((dl) => dl.companyName === normalized);
      if (!matched) continue;
      const phone = r.owner.phone;
      if (!phone) {
        skipped.push(`${r.owner.name ?? r.ownerId}: 전화번호 없음`);
        continue;
      }
      const key = `${r.ownerId}|${normalized}`;
      if (!grouped.has(key)) {
        grouped.set(key, { phone, name: r.owner.name ?? "고객", items: [] });
      }
      grouped.get(key)!.items.push({ clientName: r.clientName, companyName: r.companyName, deadline: matched.deadline });
    }

    const pfId = process.env.KAKAO_PF_ID;
    const templateId = process.env.KAKAO_TEMPLATE_DEADLINE;

    for (const [, entry] of grouped) {
      const first = entry.items[0];
      const deadlineStr = first.deadline.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
      const dayLabel = d === 0 ? "오늘" : d === 1 ? "내일" : `${d}일 후`;
      const clientList = [...new Set(entry.items.map((x) => x.clientName))].join(", ");

      const text =
        `[${dayLabel}] ${first.companyName} 통계제출 마감 안내\n` +
        `마감: ${deadlineStr}\n` +
        `대상 거래처: ${clientList}\n` +
        `KMD 통합 플랫폼에서 제출해주세요.`;

      if (dryRun) {
        sent.push({ to: entry.phone, companyName: first.companyName, deadline: first.deadline.toISOString(), days: d });
        continue;
      }

      try {
        if (pfId && templateId) {
          await sendAlimtalk(
            entry.phone,
            {
              pfId,
              templateId,
              variables: {
                "#{이름}": entry.name,
                "#{제약사}": first.companyName,
                "#{마감일}": deadlineStr,
                "#{거래처}": clientList,
                "#{시점}": dayLabel,
              },
            },
            text,
          );
        }
        sent.push({ to: entry.phone, companyName: first.companyName, deadline: first.deadline.toISOString(), days: d });
      } catch (err) {
        skipped.push(`${entry.phone}: ${(err as Error).message}`);
      }
    }
  }

  return NextResponse.json({
    dryRun,
    targetDays,
    sentCount: sent.length,
    skippedCount: skipped.length,
    sent,
    skipped,
  });
}
