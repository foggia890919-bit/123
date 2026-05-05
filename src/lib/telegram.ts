interface SendOptions {
  parseMode?: "Markdown" | "HTML" | "MarkdownV2";
  replyMarkup?: Record<string, unknown>;
}

export async function sendTelegramMessage(
  text: string,
  options?: SendOptions
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID_BIZ;
  if (!token || !chatId) return { ok: false, error: "ENV_MISSING" };
  try {
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
    const data = await res.json();
    return { ok: data.ok, error: data.ok ? undefined : JSON.stringify(data) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
