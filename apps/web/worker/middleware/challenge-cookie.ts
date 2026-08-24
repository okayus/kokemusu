import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { challengeCookieName, cookieBase } from "../lib/cookies";
import { getSessionSecret } from "../lib/secret";
import type { Env } from "../types";

// The WebAuthn challenge and the registration state travel in a signed,
// short-lived cookie between begin and verify. No D1 table, no cleanup job,
// single use (docs/data-model.md `session` 節).
const TTL_SEC = 5 * 60;
// Distinct audience from the session JWT: a session token can never be
// replayed as a challenge, and vice versa.
const AUD = "kokemusu:challenge";

// Everything verify needs is signed in here — nothing about ids is ever
// trusted from the client body.
export type ChallengeState =
  | { kind: "authentication" }
  | { kind: "add-credential"; uid: string }
  // Token-gated registration. `uid` is decided at begin — the existing user's
  // id when the single `user` row already exists (all-passkeys-lost recovery,
  // future RP_ID change), a fresh UUID only on first-ever registration — so a
  // retried verify can never mint a second user id.
  | { kind: "initial"; uid: string; displayName: string };

type Payload = { challenge: string; state: ChallengeState; aud: typeof AUD; exp: number };

// Callers must have checked getSessionSecret() already (they need it to decide
// between 503 and proceeding); an unset secret here is a programming error.
export async function issueChallenge(
  c: Context<Env>,
  challenge: string,
  state: ChallengeState,
): Promise<void> {
  const secret = getSessionSecret(c.env);
  if (!secret) throw new Error("issueChallenge called without SESSION_SECRET");
  const payload: Payload = {
    challenge,
    state,
    aud: AUD,
    exp: Math.floor(Date.now() / 1000) + TTL_SEC,
  };
  const token = await sign(payload, secret);
  setCookie(c, challengeCookieName(c), token, { ...cookieBase(c), maxAge: TTL_SEC });
}

// Single use: the cookie is deleted before it is validated, so a failed verify
// cannot be retried against the same challenge. Returns null on any problem
// (missing, expired, bad signature, wrong audience) — callers narrow `kind`.
export async function consumeChallenge(
  c: Context<Env>,
): Promise<{ challenge: string; state: ChallengeState } | null> {
  const name = challengeCookieName(c);
  const token = getCookie(c, name);
  deleteCookie(c, name, { path: "/" });
  if (!token) return null;
  const secret = getSessionSecret(c.env);
  if (!secret) return null;
  try {
    // hono/jwt verify checks the signature and rejects an expired `exp`
    // (unit-tested in auth.test.ts), so the TTL holds even if a client
    // replays the cookie past maxAge.
    const payload = (await verify(token, secret, "HS256")) as Payload;
    if (payload.aud !== AUD) return null;
    return { challenge: payload.challenge, state: payload.state };
  } catch {
    return null;
  }
}
