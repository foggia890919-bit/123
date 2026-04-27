import bcrypt from "bcryptjs";

/**
 * 네이버 커머스 API 전자서명 생성.
 *   password = `${clientId}_${timestamp}` 를 clientSecret 을 salt 로 bcrypt 해시 → base64.
 * 토큰 발급 시 client_secret_sign_type=A 와 함께 전달.
 */
export function buildSignature(clientId: string, clientSecret: string, timestamp: number): string {
  const password = `${clientId}_${timestamp}`;
  const hashed = bcrypt.hashSync(password, clientSecret);
  return Buffer.from(hashed, "utf-8").toString("base64");
}
