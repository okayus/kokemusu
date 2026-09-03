// Personal access tokens (features.md §7, ADR-0002) — the pure decision layer.
// Nothing here reads env, touches D1 or logs; the boundary (middleware/auth.ts,
// routes/tokens.ts) supplies bytes, timestamps and the pepper.

import { toBase64Url } from "../lib/base64url";

/**
 * The prefix is for identification, not protection: it makes a leaked token
 * greppable and lets validation reject junk with a string compare before any
 * hashing or D1 read. GitHub's free push protection does NOT know it — never
 * rely on the prefix as secret scanning (skill cloudflare-workers-pat-bearer-auth).
 */
export const PAT_PREFIX = "kokemusu_pat_";

/** 32 random bytes = 256 bits of entropy; base64url makes 43 chars, no padding. */
export const PAT_TOKEN_BYTES = 32;

/**
 * Scope vocabulary — a const tuple so `Scope` is a compile-time union: a typo in
 * a requireScope() argument fails `tsc`, not silently at runtime. MVP is
 * post:write only (`post:read` 必要になったら — docs/data-model.md); renaming a
 * scope later is a DATA migration, because parseScopes drops unknown names.
 * Sessions are never scope-limited; scopes exist to keep a leaked PAT narrow.
 */
export const SCOPES = ["post:write"] as const;
export type Scope = (typeof SCOPES)[number];

export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}

/**
 * Stored scopes JSON → typed Scope[]. Malformed JSON, non-arrays and unknown
 * scope names all collapse to "fewer scopes", never a throw: fail closed on
 * permissions, not on identity.
 */
export function parseScopes(json: string): Scope[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is Scope => typeof s === "string" && isScope(s));
  } catch {
    return [];
  }
}

/** Raw token from mint-time random bytes. The only shape validatePat accepts. */
export function patTokenFromBytes(bytes: Uint8Array): string {
  return PAT_PREFIX + toBase64Url(bytes);
}

/**
 * `Authorization` header → bare token, or null when this is not a Bearer
 * request. Deliberately case-sensitive (`Bearer ` exactly): RFC 9110 allows
 * `bearer`, but our own senders always send the canonical form, and a
 * non-matching scheme simply falls through to the cookie session.
 */
export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
}

export type TokenLiveness = "live" | "revoked" | "expired";

/** Revocation beats expiry (the UI shows 失効済み either way; order is for tests). */
export function tokenState(
  t: { revokedAt: number | null; expiresAt: number | null },
  now: number,
): TokenLiveness {
  if (t.revokedAt !== null) return "revoked";
  if (t.expiresAt !== null && t.expiresAt < now) return "expired";
  return "live";
}

/** last_used_at is written at most hourly — a busy agent must not turn every API call into a D1 write. */
export const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

export function shouldTouchLastUsed(lastUsedAt: number | null, now: number): boolean {
  return lastUsedAt === null || now - lastUsedAt > LAST_USED_THROTTLE_MS;
}

/** Lowercase hex sha256. Plain sha256 is right for 256-bit random tokens (not passwords): a slow hash would only burn CPU per request. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
