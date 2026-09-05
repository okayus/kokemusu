// Opaque keyset cursor for the feed, ordered (first_day DESC, created_at DESC,
// id DESC) — ADR-0005: the 「日」 a 苔片 stacks on first, the moment it was
// written within that day next, the id as the unique tiebreaker last.
// base64url-encoded JSON so the wire format stays a single query-param token;
// decode validates the shape strictly and returns null on anything else — the
// route turns that into a 400, and a cursor never reaches SQL unvalidated.

import { fromBase64Url, toBase64Url, utf8Bytes } from "../lib/base64url";
import { isDayKey, type DayKey } from "./day";

export type TimelineCursor = {
  /** first_day (`YYYY-MM-DD`) of the last row the client already has. */
  firstDay: DayKey;
  /** Its created_at (epoch ms) — the order within a day. */
  createdAt: number;
  /** Its id — the unique tiebreaker for 苔片 written in the same ms. */
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
  const { firstDay, createdAt, id } = parsed as Record<string, unknown>;
  if (typeof firstDay !== "string" || !isDayKey(firstDay)) return null;
  if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0) {
    return null;
  }
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  return { firstDay, createdAt, id };
}
