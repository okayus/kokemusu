import { createMiddleware } from "hono/factory";
import { fail } from "../lib/errors";
import type { Env } from "../types";

// SameSite=Lax already blocks cross-site POSTs from top-level navigations;
// this closes the rest: every non-GET /api/* request must come from our own
// origin (docs/security.md). GET/HEAD/OPTIONS are exempt so plain reads work
// without an Origin header. Phase 2's PAT (Authorization: Bearer) requests
// get exempted where the PAT middleware runs — they carry no cookie to forge.
export const csrfOriginCheck = createMiddleware<Env>(async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("Origin");
    if (!origin || origin !== c.env.ORIGIN) {
      return fail(c, "csrf_origin_mismatch");
    }
  }
  await next();
});
