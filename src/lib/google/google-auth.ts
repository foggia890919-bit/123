// Google Service Account JWT → access_token exchange
//
// Vercel 환경변수 GCP_SA_JSON 에 service account JSON 전체가 저장돼있다고 가정.
// 토큰은 50분 캐시 (실제 유효기간 1시간).
// 의존성 0 — Node crypto 만 사용.

import { createSign } from "node:crypto";

interface SaCreds {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function readCreds(): SaCreds {
  const raw = process.env.GCP_SA_JSON;
  if (!raw) throw new Error("GCP_SA_JSON 환경변수 없음");
  let creds: SaCreds;
  try {
    creds = JSON.parse(raw);
  } catch (e) {
    throw new Error(`GCP_SA_JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error("GCP_SA_JSON 에 client_email 또는 private_key 가 없음");
  }
  return creds;
}

function base64url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildJwt(creds: SaCreds, scope: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: creds.client_email,
    scope,
    aud: creds.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const signInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signInput);
  signer.end();
  const signature = base64url(signer.sign(creds.private_key));
  return `${signInput}.${signature}`;
}

export async function getAccessToken(scope = "https://www.googleapis.com/auth/cloud-platform"): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }
  const creds = readCreds();
  const jwt = buildJwt(creds, scope);
  const tokenUri = creds.token_uri || "https://oauth2.googleapis.com/token";
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${txt.slice(0, 300)}`);
  }
  const data = await res.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!data.access_token) {
    throw new Error(`Google token 응답 잘못됨: ${data.error_description ?? JSON.stringify(data)}`);
  }
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000 - 60_000, // 1분 여유
  };
  return data.access_token;
}
