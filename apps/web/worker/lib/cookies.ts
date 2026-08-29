import type { Context } from "hono";
import { deleteCookie } from "hono/cookie";
import type { Env } from "../types";

export function isHttpsOrigin(origin: string): boolean {
  return origin.startsWith("https://");
}

// Host-only on purpose: no `domain` attribute anywhere. Sibling Workers share
// <account>.workers.dev, and a Domain= cookie would be readable by all of them
// (docs/security.md). `__Host-` makes the browser enforce Secure + Path=/ +
// no Domain; it is rejected over plain http, so local dev (http://localhost)
// falls back to a bare name. Everything derives from ORIGIN — never hardcode
// `secure: true`, or cookies silently vanish over http dev/e2e.
export function sessionCookieName(c: Context<Env>): string {
  return isHttpsOrigin(c.env.ORIGIN) ? "__Host-session" : "session";
}

export function challengeCookieName(c: Context<Env>): string {
  return isHttpsOrigin(c.env.ORIGIN) ? "__Host-challenge" : "challenge";
}

export function cookieBase(c: Context<Env>) {
  return {
    httpOnly: true,
    secure: isHttpsOrigin(c.env.ORIGIN),
    sameSite: "Lax" as const,
    path: "/",
  };
}

// The ONLY way to delete our cookies. hono's serializer enforces the `__Host-`
// contract on every write — the deletion write included — and THROWS when such
// a cookie is set without `secure`. A bare deleteCookie(c, name, { path: "/" })
// therefore 500s every https request that clears a cookie, while http (bare
// names, local dev / unit tests / e2e) sails through — which is how it reached
// production unseen (2026-08-24).
export function clearCookie(c: Context<Env>, name: string): void {
  deleteCookie(c, name, { path: "/", secure: isHttpsOrigin(c.env.ORIGIN) });
}
