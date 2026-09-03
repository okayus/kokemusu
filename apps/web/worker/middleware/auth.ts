// PAT-aware authentication (features.md §7, ADR-0002, skill
// cloudflare-workers-pat-bearer-auth). A Bearer PAT is judged BEFORE the cookie
// session — an explicit credential is judged by its own scopes, and that is
// also what lets a scoped token be exercised from a logged-in browser. Which
// routes a PAT may reach is decided by the guards, not here:
//
//   requireAuth              session or PAT (POST /api/posts, GET /api/auth/me)
//   requireSession           cookie only — a PAT gets 403 session_required
//   requireScope("x:write")  PATs need the grant; sessions always pass
//
// Nothing in this file ever logs the Authorization header or a token — Workers
// Observability persists every console line (head_sampling_rate: 1).

import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import {
  extractBearerToken,
  parseScopes,
  PAT_PREFIX,
  sha256Hex,
  shouldTouchLastUsed,
  tokenState,
  type Scope,
} from "../core/pat";
import { createDb } from "../db";
import { apiToken, user } from "../db/schema";
import { fail, type ErrorType } from "../lib/errors";
import { getPatPepper } from "../lib/secret";
import type { Env } from "../types";
import { resolveSession } from "./session";

type PatPrincipal = { userId: string; displayName: string; scopes: Scope[] };

/**
 * Bearer token → principal, or null. Rejects are ordered cheapest first: no
 * Bearer scheme and junk without the `kokemusu_pat_` prefix cost a string
 * compare — no hash, no D1 — so a scanner spraying Authorization headers never
 * reaches the database. A missing pepper also answers null BEFORE hashing:
 * no pepper means no token can exist (minting is 503-gated on it).
 *
 * Revoked and expired tokens return the same null as an unknown one — the wire
 * says only 401; the settings list is where the human learns which token died.
 */
async function validatePat(c: Context<Env>): Promise<PatPrincipal | null> {
  const token = extractBearerToken(c.req.header("Authorization"));
  if (token === null || !token.startsWith(PAT_PREFIX)) return null;
  const pepper = getPatPepper(c.env);
  if (pepper === null) return null;

  const tokenHash = await sha256Hex(token + pepper);
  const db = createDb(c.env.DB);
  // One indexed point read (api_token_token_hash_unq), joined so a dangling
  // user reference falls out as null instead of a half-authenticated request.
  const rows = await db
    .select({
      id: apiToken.id,
      scopes: apiToken.scopes,
      lastUsedAt: apiToken.lastUsedAt,
      expiresAt: apiToken.expiresAt,
      revokedAt: apiToken.revokedAt,
      userId: user.id,
      displayName: user.displayName,
    })
    .from(apiToken)
    .innerJoin(user, eq(apiToken.userId, user.id))
    .where(eq(apiToken.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const now = Date.now();
  if (tokenState(row, now) !== "live") return null;

  if (shouldTouchLastUsed(row.lastUsedAt, now)) {
    await db.update(apiToken).set({ lastUsedAt: now }).where(eq(apiToken.id, row.id));
  }
  return { userId: row.userId, displayName: row.displayName, scopes: parseScopes(row.scopes) };
}

/**
 * Resolve the request's principal into the context variables (idempotent — a
 * second guard on the same request reuses the first resolution). Returns the
 * error to answer with, or null when authenticated. PAT first; an invalid
 * Bearer falls through to the cookie, where a bare CLI request then dies as a
 * plain 401 unauthorized.
 */
async function resolveAuth(c: Context<Env>): Promise<ErrorType | null> {
  if (c.get("authMethod") !== undefined) return null;

  const pat = await validatePat(c);
  if (pat) {
    c.set("userId", pat.userId);
    c.set("displayName", pat.displayName);
    c.set("authMethod", "pat");
    c.set("scopes", pat.scopes);
    return null;
  }

  const resolved = await resolveSession(c);
  if (resolved.kind === "session") {
    c.set("userId", resolved.userId);
    c.set("displayName", resolved.displayName);
    c.set("authMethod", "session");
    c.set("scopes", []);
    return null;
  }
  return resolved.kind === "expired" ? "session_expired" : "unauthorized";
}

/** Session or PAT. The base gate of the protected /api group. */
export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const error = await resolveAuth(c);
  if (error !== null) return fail(c, error);
  await next();
});

/**
 * Cookie session specifically — a valid PAT is refused with 403
 * session_required. Guards everything that manages credentials or reads what a
 * post:write token has no business seeing (the decrypted timeline, stats,
 * tags, and above all /api/tokens: PAT で PAT は作れない).
 */
export const requireSession = createMiddleware<Env>(async (c, next) => {
  const error = await resolveAuth(c);
  if (error !== null) return fail(c, error);
  if (c.get("authMethod") !== "session") return fail(c, "session_required");
  await next();
});

/**
 * Scope gate for PAT-reachable routes. Sessions pass every scope; a PAT needs
 * the named grant. Self-resolving so it fails closed (401) even if someone
 * later mounts it without requireAuth in front — the skill's listed pitfall.
 */
export function requireScope(scope: Scope) {
  return createMiddleware<Env>(async (c, next) => {
    const error = await resolveAuth(c);
    if (error !== null) return fail(c, error);
    if (c.get("authMethod") === "pat" && !(c.get("scopes") ?? []).includes(scope)) {
      return fail(c, "insufficient_scope");
    }
    await next();
  });
}
