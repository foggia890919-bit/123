import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

interface SendOptions {
  parseMode?: "Markdown" | "HTML" | "MarkdownV2";
  replyMarkup?: Record<string, unknown>;
}

export async function sendTelegramMessage(
  text: string,
  options?: SendOptions
): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID_BIZ;
  if (!token || !chatId) return { ok: false, error: "ENV_MISSING" };

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: options?.parseMode ?? "Markdown",
      ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    }),
  });
  return await res.json();
}

// POST /api/telegram/send — 내부 호출용. BIZ/ADMIN 세션 또는 CRON_SECRET 필요.
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  // CRON_SECRET 인증
  const authHeader = req.headers.get("authorization");
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    // 세션 인증 (BIZ 이상)
    const session = await getServerSession(authOptions);
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (!session || (role !== "BIZ" && role !== "ADMIN")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.text !== "string") {
    return NextResponse.json({ error: "text 필드가 필요합니다" }, { status: 400 });
  }

  const result = await sendTelegramMessage(body.text, {
    parseMode: body.parseMode,
    replyMarkup: body.replyMarkup,
  });

  return NextResponse.json(result);
}
