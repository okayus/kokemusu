import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import { createDb } from "../db";
import { session, user } from "../db/schema";
import { clearCookie, cookieBase, sessionCookieName } from "../lib/cookies";
import { fail } from "../lib/errors";
import { getSessionSecret } from "../lib/secret";
import type { Env } from "../types";

// Sessions are an HS256 JWT carrying `sid`, backed by a `session` row — the
// row is the source of truth, so deleting it revokes the JWT immediately
// (docs/security.md). Expiry slides while the session is in use.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUD = "kokemusu:session";

type SessionPayload = { sid: string; aud: typeof AUD; exp: number };

async function writeSessionCookie(
  c: Context<Env>,
  secret: string,
  sid: string,
  expiresAtMs: number,
): Promise<void> {
  const payload: SessionPayload = { sid, aud: AUD, exp: Math.floor(expiresAtMs / 1000) };
  const token = await sign(payload, secret);
  setCookie(c, sessionCookieName(c), token, {
    ...cookieBase(c),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

// Called by register/verify and login/verify after the ceremony succeeded.
// Callers must have checked getSessionSecret() already.
export async function issueSession(c: Context<Env>, userId: string): Promise<void> {
  const secret = getSessionSecret(c.env);
  if (!secret) throw new Error("issueSession called without SESSION_SECRET");
  const sid = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await createDb(c.env.DB)
    .insert(session)
    .values({ id: sid, userId, expiresAt, createdAt: now });
  await writeSessionCookie(c, secret, sid, expiresAt);
}

// Logout. Deleting the row is what kills the JWT; clearing the cookie is
// cosmetic. A missing/garbage token still clears the cookie and succeeds.
export async function revokeSession(c: Context<Env>): Promise<void> {
  const name = sessionCookieName(c);
  const token = getCookie(c, name);
  const secret = getSessionSecret(c.env);
  if (token && secret) {
    try {
      const payload = (await verify(token, secret, "HS256")) as SessionPayload;
      if (payload.aud === AUD) {
        await createDb(c.env.DB).delete(session).where(eq(session.id, payload.sid));
      }
    } catch {
      // invalid token: nothing to revoke
    }
  }
  clearCookie(c, name);
}

export function sessionMiddleware() {
  return createMiddleware<Env>(async (c, next) => {
    // No secret = no session can be valid. Fail closed before touching D1.
    const secret = getSessionSecret(c.env);
    if (!secret) return fail(c, "unauthorized");

    const name = sessionCookieName(c);
    const token = getCookie(c, name);
    if (!token) return fail(c, "unauthorized");

    let payload: SessionPayload;
    try {
      payload = (await verify(token, secret, "HS256")) as SessionPayload;
    } catch {
      return fail(c, "unauthorized");
    }
    if (payload.aud !== AUD) return fail(c, "unauthorized");

    const db = createDb(c.env.DB);
    const rows = await db
      .select({
        sid: session.id,
        expiresAt: session.expiresAt,
        userId: session.userId,
        displayName: user.displayName,
      })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(eq(session.id, payload.sid));
    const row = rows[0];
    if (!row) {
      // Revoked elsewhere, or rows were cleared after a secret rotation.
      clearCookie(c, name);
      return fail(c, "session_expired");
    }
    if (row.expiresAt < Date.now()) {
      // Lazy cleanup of the expired row on presentation.
      await db.delete(session).where(eq(session.id, row.sid));
      clearCookie(c, name);
      return fail(c, "session_expired");
    }

    c.set("userId", row.userId);
    c.set("displayName", row.displayName);

    // Sliding expiry: refresh when less than half the TTL remains — one D1
    // write per ~15 days per active session, not one per request.
    if (row.expiresAt - Date.now() < SESSION_TTL_MS / 2) {
      const newExpiresAt = Date.now() + SESSION_TTL_MS;
      await db.update(session).set({ expiresAt: newExpiresAt }).where(eq(session.id, row.sid));
      await writeSessionCookie(c, secret, row.sid, newExpiresAt);
    }

    await next();
  });
}
