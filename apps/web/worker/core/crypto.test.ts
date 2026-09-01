import { describe, expect, it } from "vitest";
import { BODY_KEY_ID, decryptBody, encryptBody, envelopeKeyId, importBodyKey } from "./crypto";

// Standard-base64 32 bytes — the exact shape `openssl rand -base64 32` emits
// (44 chars, "=" padded).
function randomKeyBase64(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}

async function newKey(): Promise<CryptoKey> {
  const key = await importBodyKey(randomKeyBase64());
  if (key === null) throw new Error("test key failed to import");
  return key;
}

const ENVELOPE_SHAPE = /^k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/;

describe("importBodyKey", () => {
  it("accepts openssl-style padded base64, trailing newline included", async () => {
    expect(await importBodyKey(randomKeyBase64())).not.toBeNull();
    expect(await importBodyKey(randomKeyBase64() + "\n")).not.toBeNull();
  });

  it("rejects a key that is not exactly 32 bytes", async () => {
    const sixteenBytes = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    expect(await importBodyKey(sixteenBytes)).toBeNull();
  });

  it("rejects non-base64 input and the empty string", async () => {
    expect(await importBodyKey("not-base64!!!")).toBeNull();
    expect(await importBodyKey("")).toBeNull();
  });
});

describe("encryptBody", () => {
  it("produces the k1.<iv>.<ciphertext> envelope in base64url", async () => {
    const envelope = await encryptBody("苔むす", await newKey());
    expect(envelope).toMatch(ENVELOPE_SHAPE);
    expect(envelope.startsWith(`${BODY_KEY_ID}.`)).toBe(true);
    expect(envelope).not.toContain("=");
  });

  it("uses a fresh iv on every call (same plaintext, same key)", async () => {
    const key = await newKey();
    const a = await encryptBody("同じ本文", key);
    const b = await encryptBody("同じ本文", key);
    expect(a).not.toBe(b);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
    expect(await decryptBody(a, key)).toBe("同じ本文");
    expect(await decryptBody(b, key)).toBe("同じ本文");
  });

  it("never leaks the plaintext into the envelope", async () => {
    // Non-ASCII plaintext cannot appear verbatim in a base64url string.
    const envelope = await encryptBody("秘密の日記", await newKey());
    expect(envelope).not.toContain("秘密");
  });
});

describe("decryptBody", () => {
  it("round-trips ASCII, multibyte, empty, and long multi-line bodies", async () => {
    const key = await newKey();
    for (const plain of [
      "hello, moss",
      "苔むす日記 🌱 — TypeScript を 3 時間",
      "",
      "一行の苔片\n".repeat(1000),
    ]) {
      expect(await decryptBody(await encryptBody(plain, key), key)).toBe(plain);
    }
  });

  it("fails with a different key", async () => {
    const envelope = await encryptBody("本文", await newKey());
    await expect(decryptBody(envelope, await newKey())).rejects.toThrow("body_decrypt_failed");
  });

  it("fails when the ciphertext is tampered with", async () => {
    const key = await newKey();
    const envelope = await encryptBody("本文", key);
    // Flip the FIRST ciphertext char — its bits always survive base64url
    // decoding, while the last char may hold only padding bits atob discards.
    const i = envelope.lastIndexOf(".") + 1;
    const tampered =
      envelope.slice(0, i) + (envelope[i] === "A" ? "B" : "A") + envelope.slice(i + 1);
    await expect(decryptBody(tampered, key)).rejects.toThrow("body_decrypt_failed");
  });

  it("fails on an unknown key generation", async () => {
    const key = await newKey();
    const envelope = await encryptBody("本文", key);
    await expect(decryptBody(envelope.replace(/^k1\./, "k9."), key)).rejects.toThrow(
      "body_decrypt_failed",
    );
  });

  it("rejects malformed envelopes without reaching WebCrypto", async () => {
    const key = await newKey();
    for (const bad of [
      "",
      "平文のまま保存された本文",
      "k1.onlytwoparts",
      "k1.tooShortIv.AAAAAAAAAAAAAAAAAAAAAA",
      // standard base64 alphabet ("+") is not a valid envelope
      "k1.AAAAAAAAAAAAAA+A.AAAAAAAAAAAAAAAAAAAAAA",
      ".AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA",
    ]) {
      await expect(decryptBody(bad, key)).rejects.toThrow("body_decrypt_failed");
    }
  });
});

describe("envelopeKeyId", () => {
  it("extracts the generation from an envelope", async () => {
    expect(envelopeKeyId(await encryptBody("本文", await newKey()))).toBe(BODY_KEY_ID);
  });

  it("parses future generations without decrypting", () => {
    expect(envelopeKeyId("k2.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA")).toBe("k2");
  });

  it("returns null for anything that is not an envelope", () => {
    expect(envelopeKeyId("")).toBeNull();
    expect(envelopeKeyId("平文のまま保存された本文")).toBeNull();
    expect(envelopeKeyId("k1.short.AAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
  });
});
