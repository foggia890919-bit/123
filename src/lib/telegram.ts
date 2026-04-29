export interface TelegramCreds {
  telegramBotToken?: string | null;
  telegramChatId?: string | null;
}

export async function sendTelegram(text: string, ws?: TelegramCreds): Promise<{ ok: boolean; error?: string }> {
  const token = ws?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = ws?.telegramChatId || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, error: "TELEGRAM not configured" };
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `${res.status} ${body}` };
  }
  return { ok: true };
}
