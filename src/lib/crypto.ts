import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * 워크스페이스/스토어 시크릿 보호.
 * - 환경변수 ENCRYPTION_KEY (32바이트 권장, hex 64글자) 로 AES-256-GCM 암호화.
 * - 키 없으면 평문 그대로 저장 (개발 편의). 운영에선 반드시 설정.
 * - 저장 형식: enc1:base64(iv):base64(tag):base64(ct)
 * - 평문(legacy) 도 자동 인식해서 decrypt() 가 그대로 반환 → 무중단 마이그레이션.
 */

const FORMAT = "enc1";

function getKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  // hex 64 글자면 그대로, 아니면 sha256 해시로 32바이트 만들기
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

export function encrypt(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return plain ?? null;
  const key = getKey();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${FORMAT}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(`${FORMAT}:`)) return stored; // legacy plaintext
  const key = getKey();
  if (!key) {
    // 키 없는데 암호문이 들어옴 — 키 손실로 복호화 불가
    throw new Error("ENCRYPTION_KEY missing — cannot decrypt stored secret");
  }
  const [, ivB, tagB, ctB] = stored.split(":");
  const iv = Buffer.from(ivB, "base64");
  const tag = Buffer.from(tagB, "base64");
  const ct = Buffer.from(ctB, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(`${FORMAT}:`);
}
