import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for merchant secrets (e.g. a Klaviyo private key).
 * Key: APP_ENCRYPTION_KEY, 32 bytes as 64 hex chars or base64.
 * Format: v1.<iv b64>.<tag b64>.<ciphertext b64>
 */

function key(): Buffer | null {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

export function encryptionAvailable(): boolean {
  return key() !== null;
}

export function encryptSecret(plain: string, aad = "delaywise"): string {
  const k = key();
  if (!k) throw new Error("APP_ENCRYPTION_KEY is not set (32 bytes, hex or base64)");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decryptSecret(token: string, aad = "delaywise"): string | null {
  const k = key();
  const parts = token.split(".");
  if (!k || parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(parts[1], "base64"));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** "pk_abc…xyz" for display; never return the full secret to the browser. */
export function maskSecret(plain: string | null): string {
  if (!plain) return "";
  return plain.length <= 8 ? "••••" : `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}
