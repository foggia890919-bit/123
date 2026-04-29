import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/app/api/telegram/send/route";

const PRIORITY: Record<string, number> = {
  blocker: 0,
  decision_needed: 1,
  completed: 2,
  info: 3,
};

const TYPE_LABEL: Record<string, string> = {
  blocker: "🚫 블로커",
  decision_needed: "⚠️ 결정 필요",
  completed: "✅ 완료",
  info: "📋 정보",
};

function formatKSTDate(): string {
  const now = new Date();
  // UTC+9
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildDigestMessage(
  grouped: Record<string, Array<{ title: string; body: string; decisionOptions: unknown; type: string }>>,
  date: string
): string {
  const lines: string[] = [`🌅 비즈 관리 일일 디제스트 - ${date}`, ""];

  // 타입별 그룹핑 (priority 순)
  const byType: Record<string, typeof grouped[string]> = {};
  for (const items of Object.values(grouped)) {
    for (const item of items) {
      if (!byType[item.type]) byType[item.type] = [];
      byType[item.type].push(item);
    }
  }

  const sortedTypes = Object.keys(byType).sort(
    (a, b) => (PRIORITY[a] ?? 99) - (PRIORITY[b] ?? 99)
  );

  for (const type of sortedTypes) {
    const items = byType[type];
    const label = TYPE_LABEL[type] ?? type;
    lines.push(`${label} (${items.length}건)`);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const num = i + 1;

      if (type === "decision_needed" && Array.isArray(item.decisionOptions) && item.decisionOptions.length > 0) {
        const opts = (item.decisionOptions as Array<{ id: string; label: string }>)
          .map((o) => o.label)
          .join(" vs ");
        const first = (item.decisionOptions as Array<{ id: string; label: string }>)[0]?.label;
        lines.push(`${num}. ${item.title} — ${opts} (메인 추천: ${first})`);
        lines.push(`   답변: "${num}: ${(item.decisionOptions as Array<{ id: string; label: string }>).map((o) => o.label).join('" 또는 "' + num + ': ')}"`);
      } else {
        lines.push(`- ${item.title}`);
        if (item.body && item.body !== item.title) {
          lines.push(`  ${item.body.split("\n")[0]}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

// 4096자 초과 시 분할
function splitMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxLen;
    if (end < text.length) {
      // 줄 바꿈 기준으로 자름
      const lastNl = text.lastIndexOf("\n", end);
      if (lastNl > start) end = lastNl;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

async function sendWithRetry(text: string): Promise<boolean> {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    let result = await sendTelegramMessage(chunk);
    if (!result.ok) {
      // 리트라이 1회
      result = await sendTelegramMessage(chunk);
      if (!result.ok) {
        console.error("[biz-digest] 텔레그램 발송 실패:", result.error ?? result);
        return false;
      }
    }
  }
  return true;
}

// GET /api/cron/biz-digest
// Vercel cron (UTC 0:00 = KST 9:00) 또는 CRON_SECRET으로 수동 호출
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 401 });
  }

  const authHeader = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");

  if (authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 미발송 항목 조회
  const pending = await prisma.bizDigestQueue.findMany({
    where: { sentAt: null },
    orderBy: { createdAt: "asc" },
  });

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, message: "발송할 항목 없음" });
  }

  // 카테고리별 그룹핑
  const grouped: Record<string, Array<{
    title: string;
    body: string;
    decisionOptions: unknown;
    type: string;
  }>> = {};

  for (const item of pending) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push({
      title: item.title,
      body: item.body,
      decisionOptions: item.decisionOptions,
      type: item.type,
    });
  }

  const date = formatKSTDate();
  const message = buildDigestMessage(grouped, date);

  const sent = await sendWithRetry(message);
  if (!sent) {
    return NextResponse.json({ ok: false, error: "텔레그램 발송 실패" }, { status: 502 });
  }

  // 발송된 항목 sentAt 업데이트
  const ids = pending.map((p) => p.id);
  await prisma.bizDigestQueue.updateMany({
    where: { id: { in: ids } },
    data: { sentAt: new Date() },
  });

  return NextResponse.json({ ok: true, sent: ids.length });
}
