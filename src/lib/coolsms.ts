import { createHmac } from "crypto";

function makeAuthHeader(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = Math.random().toString(36).slice(2, 14);
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 ApiKey=${apiKey}, Date=${date}, Salt=${salt}, Signature=${signature}`;
}

export async function sendSms(to: string, text: string): Promise<void> {
  const apiKey = process.env.COOLSMS_API_KEY;
  const apiSecret = process.env.COOLSMS_API_SECRET;
  const from = process.env.COOLSMS_SENDER;

  if (!apiKey || !apiSecret || !from) {
    throw new Error("Coolsms 환경변수(COOLSMS_API_KEY, COOLSMS_API_SECRET, COOLSMS_SENDER)가 설정되지 않았어요.");
  }

  const digits = to.replace(/\D/g, "");

  const res = await fetch("https://api.coolsms.co.kr/messages/v4/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: makeAuthHeader(apiKey, apiSecret),
    },
    body: JSON.stringify({
      message: { to: digits, from, text },
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.errorMessage || `SMS 발송 실패 (${res.status})`);
  }
}
