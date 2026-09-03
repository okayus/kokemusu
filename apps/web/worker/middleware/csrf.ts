import { createMiddleware } from "hono/factory";
import { fail } from "../lib/errors";
import type { Env } from "../types";

// SameSite=Lax already blocks cross-site POSTs from top-level navigations;
// this closes the rest: every non-GET /api/* request must come from our own
// origin (docs/security.md). GET/HEAD/OPTIONS are exempt so plain reads work
// without an Origin header.
//
// Bearer (PAT) requests are exempt too: CSRF forges the *ambient* credential —
// the cookie the browser attaches on its own — and a cross-site page can never
// attach an Authorization header without a CORS preflight we don't answer. The
// exemption keys on the header's PRESENCE, not validity: an invalid token then
// dies at requireAuth as a plain 401, with no cookie usable along the way.
// Requiring Origin here would only lock out every legitimate CLI/Worker sender.
export const csrfOriginCheck = createMiddleware<Env>(async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const isBearer = c.req.header("Authorization")?.startsWith("Bearer ") ?? false;
    if (!isBearer) {
      const origin = c.req.header("Origin");
      if (!origin || origin !== c.env.ORIGIN) {
        return fail(c, "csrf_origin_mismatch");
      }
    }
  }
  await next();
});
