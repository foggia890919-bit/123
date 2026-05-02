// AES-256-GCM helper for storing third-party credentials (e.g. ePharms PW).
// Key is read from EPHARMS_ENC_KEY (32-byte key, hex or base64). Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Stored format: "<ivBase64>:<authTagBase64>:<cipherBase64>"

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function loadKey(): Buffer {
  const raw = process.env.EPHARMS_ENC_KEY;
  if (!raw) throw new Error("EPHARMS_ENC_KEY env var is required");
  // Try hex first (64 chars = 32 bytes), then base64.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("EPHARMS_ENC_KEY must decode to exactly 32 bytes");
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const key = loadKey();
  const [ivB64, tagB64, encB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("malformed encrypted secret");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const enc = Buffer.from(encB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

// Mask for display: "abcd1234" → "ab****34"
export function maskSecret(plain: string): string {
  if (!plain) return "";
  if (plain.length <= 4) return "****";
  return plain.slice(0, 2) + "****" + plain.slice(-2);
}
