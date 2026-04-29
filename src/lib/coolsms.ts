import { createHmac } from "crypto";

// ─── 알림톡 타입 ────────────────────────────────────────────────────────────
export interface AlimtalkButton {
  buttonType: "WL" | "AL" | "BK" | "MD";
  buttonName: string;
  linkMo?: string;
  linkPc?: string;
}

export interface AlimtalkOptions {
  pfId: string;
  templateId: string;
  variables?: Record<string, string>;
  buttons?: AlimtalkButton[];
}

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

// ─── 카카오 알림톡 발송 ──────────────────────────────────────────────────────
export async function sendAlimtalk(
  to: string,
  kakao: AlimtalkOptions,
  fallbackText?: string
): Promise<void> {
  const apiKey = process.env.COOLSMS_API_KEY;
  const apiSecret = process.env.COOLSMS_API_SECRET;
  const from = process.env.COOLSMS_SENDER;

  if (!apiKey || !apiSecret || !from) {
    throw new Error("Coolsms 환경변수가 설정되지 않았어요.");
  }
  if (!kakao.pfId || !kakao.templateId) {
    throw new Error("KAKAO_PF_ID 또는 KAKAO_TEMPLATE_* 환경변수가 없어요.");
  }

  const digits = to.replace(/\D/g, "");

  const body: Record<string, unknown> = {
    message: {
      to: digits,
      from,
      // 알림톡 실패 시 SMS로 대체
      ...(fallbackText ? { text: fallbackText } : {}),
      kakaoOptions: {
        pfId: kakao.pfId,
        templateId: kakao.templateId,
        ...(kakao.variables ? { variables: kakao.variables } : {}),
        ...(kakao.buttons ? { buttons: kakao.buttons } : {}),
      },
    },
  };

  const res = await fetch("https://api.coolsms.co.kr/messages/v4/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: makeAuthHeader(apiKey, apiSecret),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.errorMessage || `알림톡 발송 실패 (${res.status})`);
  }
}
