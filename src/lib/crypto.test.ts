import { describe, it, expect, beforeEach } from "vitest";
import { encrypt, decrypt, isEncrypted } from "./crypto";

describe("crypto with key", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "0".repeat(64); // 32 bytes hex
  });
  it("round trip", () => {
    const enc = encrypt("hello world");
    expect(enc).toBeTruthy();
    expect(enc!.startsWith("enc1:")).toBe(true);
    expect(decrypt(enc)).toBe("hello world");
  });
  it("isEncrypted detects format", () => {
    const enc = encrypt("secret");
    expect(isEncrypted(enc)).toBe(true);
    expect(isEncrypted("plain text")).toBe(false);
  });
  it("legacy plaintext passes through decrypt", () => {
    expect(decrypt("legacy-secret")).toBe("legacy-secret");
  });
  it("null/empty handled", () => {
    expect(encrypt(null)).toBeNull();
    expect(encrypt("")).toBe("");
    expect(decrypt(null)).toBe("");
    expect(decrypt(undefined)).toBe("");
  });
  it("each encryption uses fresh IV (different ciphertext)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });
});

describe("crypto without key", () => {
  beforeEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });
  it("plaintext fallback", () => {
    expect(encrypt("hello")).toBe("hello");
    expect(decrypt("hello")).toBe("hello");
  });
});
