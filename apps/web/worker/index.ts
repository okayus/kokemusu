import { Hono } from "hono";
import { runScheduled } from "./cron";
import { fail } from "./lib/errors";
import { requireAuth, requireSession } from "./middleware/auth";
import { csrfOriginCheck } from "./middleware/csrf";
import { apiRateLimit } from "./middleware/rate-limit";
import { securityHeaders } from "./middleware/security-headers";
import { authRoutes } from "./routes/auth";
import { postRoutes } from "./routes/posts";
import { statsRoutes } from "./routes/stats";
import { tagRoutes } from "./routes/tags";
import { tokenRoutes } from "./routes/tokens";
import type { Bindings, Env } from "./types";

export const app = new Hono<Env>();

// First, so every response — SPA HTML included (that is why run_worker_first
// exists) — carries the security headers.
app.use("*", securityHeaders);

app.onError((err, c) => {
  // Generic 500 only; never a stack trace to the client.
  console.error(err);
  return fail(c, "internal");
});

app.get("/health", (c) => c.json({ status: "ok" }));

const api = new Hono<Env>();
api.use("*", csrfOriginCheck);

// Every /api response is dynamic and private — decrypted bodies ride on the
// timeline — so heuristic browser/proxy caching must never keep a copy.
api.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

// Mount order matters (skill cloudflare-workers-passkey-auth): the public
// /auth routes must be registered BEFORE the session-guarded catch-all below —
// its `use("*")` also matches /api/auth/*, and the public handlers only win
// because they answered first. Swap the two and login/begin returns 401.
api.route("/auth", authRoutes);

// Everything else under /api requires authentication: domain routes register
// on `protectedApi` ABOVE the 404 catch-all. Layering (features.md §7):
//
//   apiRateLimit   per-IP, before auth — a Bearer guess must be throttled
//                  before it can spend a sha256 + D1 read
//   requireAuth    session or PAT (PAT judged first)
//   /posts         the PAT-reachable router; gates per method inside
//   requireSession everything registered BELOW is cookie-only — a PAT stops
//                  with 403 session_required, and new routes added down here
//                  are session-only by default (fail closed, not fail open)
const protectedApi = new Hono<Env>();
protectedApi.use("*", apiRateLimit);
protectedApi.use("*", requireAuth);
protectedApi.route("/posts", postRoutes);
protectedApi.use("*", requireSession);
protectedApi.route("/tokens", tokenRoutes);
protectedApi.route("/stats", statsRoutes);
protectedApi.route("/tags", tagRoutes);
protectedApi.all("*", (c) => fail(c, "not_found"));
api.route("/", protectedApi);

app.route("/api", api);

// L3 of the 3-layer SPA routing: with `run_worker_first: true` every request
// enters the Worker, so unmatched paths must be handed back to the Assets
// binding explicitly (which then applies `not_found_handling`).
app.notFound(async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  return new Response(res.body, res);
});

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(event, env));
  },
} satisfies ExportedHandler<Bindings>;
