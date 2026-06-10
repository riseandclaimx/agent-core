import { createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual as nodeTSE } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const keyEnv = process.env.ENCRYPTION_KEY;
  if (!keyEnv) throw new Error("ENCRYPTION_KEY env var not set");
  return Buffer.from(keyEnv, "base64url");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function hmacSha256(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return nodeTSE(bufA, bufB);
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64url");
}

export function verifySignature(secret: string, timestamp: string, body: string, signature: string): boolean {
  const sigBase = `v0:${timestamp}:${body}`;
  const expected = `v0=${hmacSha256(sigBase, secret)}`;
  return timingSafeEqual(expected, signature);
}
