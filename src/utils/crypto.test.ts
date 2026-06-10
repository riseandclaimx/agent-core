import { describe, it, expect } from "vitest";
import { encrypt, decrypt, hmacSha256, timingSafeEqual, generateEncryptionKey } from "./crypto";

describe("crypto utilities", () => {
  it("encrypt and decrypt roundtrip", () => {
    const plaintext = "Hello, World! 🤖";
    const ciphertext = encrypt(plaintext);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it("encrypt produces different output each time", () => {
    const plaintext = "test";
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2); // Different IV
    expect(decrypt(c1)).toBe(plaintext);
    expect(decrypt(c2)).toBe(plaintext);
  });

  it("hmacSha256 produces consistent output", () => {
    const data = "test data";
    const secret = "secret";
    const hmac1 = hmacSha256(data, secret);
    const hmac2 = hmacSha256(data, secret);
    expect(hmac1).toBe(hmac2);
    expect(hmac1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("timingSafeEqual works correctly", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("generateEncryptionKey produces valid base64", () => {
    const key = generateEncryptionKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Should be usable as encryption key
    const plaintext = "test";
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });
});
