// Opaque keyset cursor for the timeline, ordered (created_at DESC, id DESC).
// base64url-encoded JSON so the wire format stays a single query-param token;
// decode validates the shape strictly and returns null on anything else — the
// route turns that into a 400, and a cursor never reaches SQL unvalidated.

import { fromBase64Url, toBase64Url, utf8Bytes } from "../lib/base64url";

export type TimelineCursor = {
  /** created_at (epoch ms) of the last row the client already has. */
  createdAt: number;
  /** Its id — the unique tiebreaker for posts created in the same ms. */
  id: string;
};

export function encodeCursor(cursor: TimelineCursor): string {
  return toBase64Url(utf8Bytes(JSON.stringify(cursor)));
}

export function decodeCursor(raw: string): TimelineCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(raw)));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { createdAt, id } = parsed as Record<string, unknown>;
  if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0) {
    return null;
  }
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  return { createdAt, id };
}
