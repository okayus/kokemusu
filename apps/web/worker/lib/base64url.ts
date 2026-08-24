// Byte <-> base64url conversions at the WebAuthn boundary. The COSE public key
// is stored in D1 as base64url TEXT (docs/data-model.md), so these two are the
// only places the encoding changes.

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// TextEncoder.encode() is typed Uint8Array<ArrayBufferLike>; @simplewebauthn's
// `userID` parameter wants Uint8Array<ArrayBuffer>. Copy into a fresh buffer.
export function utf8Bytes(s: string): Uint8Array<ArrayBuffer> {
  const src = new TextEncoder().encode(s);
  const out = new Uint8Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out;
}
