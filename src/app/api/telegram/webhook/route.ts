import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";

// POST /api/telegram/webhook?token=<TELEGRAM_WEBHOOK_SECRET>
// 텔레그램이 메시지 수신 시 호출하는 webhook 엔드포인트
export async function POST(req: NextRequest) {
  // webhook secret 검증
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const tokenParam = req.nextUrl.searchParams.get("token");

  if (!webhookSecret || tokenParam !== webhookSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const update = await req.json().catch(() => null);
  if (!update) {
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  if (!message || !message.text) {
    // 텍스트 메시지가 아닌 업데이트는 무시
    return NextResponse.json({ ok: true });
  }

  const messageId = String(message.message_id);
  const chatId = String(message.chat?.id ?? "");
  const text: string = message.text;

  // reply_to_message 기반으로 digestQueueId 매핑 시도
  // 텔레그램 봇이 메시지를 보낼 때 메시지 본문에 digestQueueId를 주석으로 포함하거나
  // replyToMessageId로 추적. 여기서는 DB에 저장된 sentAt 메시지와 매핑 시도.
  let digestQueueId: string | null = null;

  const replyToMessageId = message.reply_to_message?.message_id
    ? String(message.reply_to_message.message_id)
    : null;

  if (replyToMessageId) {
    // replyToMessageId와 같은 messageId를 가진 TelegramReply가 있을 경우 해당 digestQueueId 사용
    // 단, 최초 발송 시에는 sentMessageId를 BizDigestQueue에 저장하지 않으므로
    // 여기서는 간단히 가장 최근의 미결 디제스트 중 매핑 가능한 항목을 찾음
    const existingReply = await prisma.telegramReply.findFirst({
      where: { messageId: replyToMessageId },
      select: { digestQueueId: true },
    });
    if (existingReply?.digestQueueId) {
      digestQueueId = existingReply.digestQueueId;
    }
  }

  // TelegramReply 저장 (중복 메시지 무시)
  try {
    await prisma.telegramReply.create({
      data: {
        id: randomBytes(12).toString("hex"),
        messageId,
        chatId,
        text,
        digestQueueId,
      },
    });

    // digestQueueId가 연결된 경우 resolvedAnswer 업데이트
    if (digestQueueId) {
      await prisma.bizDigestQueue.update({
        where: { id: digestQueueId },
        data: {
          resolvedAt: new Date(),
          resolvedBy: "사용자가 텔레그램으로 답변",
          resolvedAnswer: text,
        },
      });
    }
  } catch (err: unknown) {
    // messageId unique 충돌 등 — 중복 webhook 호출은 무시
    if (
      err instanceof Error &&
      err.message.includes("Unique constraint")
    ) {
      return NextResponse.json({ ok: true });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
