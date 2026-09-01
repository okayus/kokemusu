import { Hono } from "hono";
import { runScheduled } from "./cron";
import { fail } from "./lib/errors";
import { csrfOriginCheck } from "./middleware/csrf";
import { securityHeaders } from "./middleware/security-headers";
import { sessionMiddleware } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { postRoutes } from "./routes/posts";
import { tagRoutes } from "./routes/tags";
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

// Everything else under /api requires a session: domain routes register on
// `protectedApi` ABOVE the 404 catch-all.
const protectedApi = new Hono<Env>();
protectedApi.use("*", sessionMiddleware());
protectedApi.route("/posts", postRoutes);
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
