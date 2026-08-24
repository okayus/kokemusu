import { createMiddleware } from "hono/factory";
import { fail } from "../lib/errors";
import type { Env } from "../types";

// Per-IP limit for the only unauthenticated routes that spend CPU before auth
// (register/login begin|verify). Limits live in wrangler.jsonc `ratelimits`
// (30 req / 60 s — plenty for one human, still stops scanners; skill
// cloudflare-workers-bot-scan-defense).
//
// Fails OPEN when the binding is absent: local dev and the e2e config run
// without it, and a missing binding must degrade to "no limit", never to a
// login outage. This also makes a 429 in a burst test positive proof the
// binding is live (no binding can never 429).
export const authRateLimit = createMiddleware<Env>(async (c, next) => {
  const limiter = c.env.AUTH_RATE_LIMITER;
  if (limiter) {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const { success } = await limiter.limit({ key: ip });
    if (!success) return fail(c, "rate_limited");
  }
  await next();
});
