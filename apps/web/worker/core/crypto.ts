// Body encryption at the app layer (ADR-0001): AES-256-GCM over the post body
// (and title), envelope `k1.<iv base64url>.<ciphertext base64url>`. Pure
// functions only — the key arrives as an argument (the boundary imports it from
// the BODY_KEY secret once), nothing here reads env, touches D1, or logs.
//
// The `k<n>` prefix is the key generation. Rotation adds `k2` and re-encrypts
// row by row; `envelopeKeyId` exists so that job can find rows still on an old
// generation without attempting a decrypt.

import { fromBase64Url, toBase64Url, utf8Bytes } from "../lib/base64url";

export const BODY_KEY_ID = "k1";

// 12-byte random nonce, the GCM standard. 12 bytes -> exactly 16 base64url
// chars, and the 16-byte GCM tag alone -> at least 22 chars of ciphertext, so
// the regex pins both and a malformed envelope fails parsing, never
// subtle.decrypt.
const IV_BYTES = 12;
const ENVELOPE = /^(k\d+)\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22,})$/;

/**
 * Parse the BODY_KEY secret — standard base64, exactly 32 bytes, the shape
 * `openssl rand -base64 32` emits — into a non-extractable AES-GCM key.
 * Anything else returns null so the boundary can fail closed; deliberately no
 * logging here, and the value never rides on an error.
 */
export async function importBodyKey(secret: string): Promise<CryptoKey | null> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    const bin = atob(secret.trim());
    raw = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  if (raw.byteLength !== 32) return null;
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptBody(plain: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, utf8Bytes(plain));
  return `${BODY_KEY_ID}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypt an envelope produced by encryptBody. Every failure — malformed
 * envelope, unknown key generation, wrong key, tampered ciphertext — throws
 * the same bare `body_decrypt_failed`: app.onError logs the error object, so
 * it must never carry the envelope, the key, or the WebCrypto cause.
 */
export async function decryptBody(envelope: string, key: CryptoKey): Promise<string> {
  const m = ENVELOPE.exec(envelope);
  const iv = m?.[2];
  const ciphertext = m?.[3];
  if (m?.[1] !== BODY_KEY_ID || iv === undefined || ciphertext === undefined) {
    throw new Error("body_decrypt_failed");
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(iv) },
      key,
      fromBase64Url(ciphertext),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("body_decrypt_failed");
  }
}

/**
 * Key generation of an envelope ("k1"), or null if the string is not an
 * envelope — e.g. a row written before encryption existed. Read-only shape
 * check; never decrypts.
 */
export function envelopeKeyId(envelope: string): string | null {
  return ENVELOPE.exec(envelope)?.[1] ?? null;
}
