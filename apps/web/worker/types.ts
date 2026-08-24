// Single source of truth for the Worker's bindings. Every other worker file
// imports this type; never re-declare it inline.
//
// Deliberately NOT the `wrangler types` output: the generated Env only knows
// what wrangler.jsonc and a local .dev.vars declare, so secrets would type
// differently in CI (no .dev.vars there) than in the sandbox.
export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  // WebAuthn relying party, locked in wrangler.jsonc (see the comment there).
  RP_ID: string;
  ORIGIN: string;
  // Per-IP limiter for the public auth routes. Optional on purpose: local dev
  // and the e2e config may run without it, and the middleware fails OPEN so a
  // missing binding degrades to "no limit", never to a login outage.
  AUTH_RATE_LIMITER?: RateLimit;
  // Worker Secret (openssl rand -hex 32). Signs the session JWT and the
  // WebAuthn challenge cookie. Unset (or shorter than 32 chars) = every auth
  // route fails closed, so merging before `wrangler secret put` is safe.
  SESSION_SECRET?: string;
  // Worker Secret, present only while bootstrapping passkeys. Unset =
  // `403 registration_closed` — the registration door is shut by default.
  INITIAL_REGISTRATION_TOKEN?: string;
  // .dev.vars only ("1" during `vite dev`): relaxes the CSP so Vite's inline
  // HMR preamble can run. Never set in production or for e2e.
  DEV_CSP?: string;
};

/** Hono generics: bindings plus the per-request variables set by sessionMiddleware. */
export type Env = {
  Bindings: Bindings;
  Variables: {
    userId: string;
    displayName: string;
  };
};
