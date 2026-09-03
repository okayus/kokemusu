import type { Scope } from "./core/pat";

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
  // Per-IP limiter for the rest of /api — PAT routes are reachable without a
  // session, so well-formed Bearer guesses must not turn into unbounded D1
  // reads. Separate from AUTH_RATE_LIMITER on purpose: one busy sender must
  // never eat the login budget. Same fail-open contract as above.
  API_RATE_LIMITER?: RateLimit;
  // Worker Secret (openssl rand -hex 32). Signs the session JWT and the
  // WebAuthn challenge cookie. Unset (or shorter than 32 chars) = every auth
  // route fails closed, so merging before `wrangler secret put` is safe.
  SESSION_SECRET?: string;
  // Worker Secret, present only while bootstrapping passkeys. Unset =
  // `403 registration_closed` — the registration door is shut by default.
  INITIAL_REGISTRATION_TOKEN?: string;
  // Worker Secret: AES-256-GCM key for body/title encryption at rest
  // (ADR-0001, worker/core/crypto.ts). Standard base64, exactly 32 bytes;
  // the same value lives in 1Password — losing it makes every stored body
  // unrecoverable. Not read until PR4 wires the posts routes; those will
  // fail closed when it is unset or malformed.
  BODY_KEY?: string;
  // Worker Secret (openssl rand -hex 32): the pepper in api_token.token_hash =
  // sha256(token + PAT_PEPPER). Unset (or < 32 chars) = minting 503s and Bearer
  // auth matches nothing (fail closed, lib/secret.ts) — so merging before
  // `wrangler secret put PAT_PEPPER` is safe, and a token can never be minted
  // against the empty pepper. NEVER rotate casually: a new value orphans every
  // stored hash = every PAT dies at once (docs/data-model.md api_token).
  PAT_PEPPER?: string;
  // .dev.vars only ("1" during `vite dev`): relaxes the CSP so Vite's inline
  // HMR preamble can run. Never set in production or for e2e.
  DEV_CSP?: string;
};

/** How the current request authenticated (middleware/auth.ts). */
export type AuthMethod = "session" | "pat";

/** Hono generics: bindings plus the per-request variables set by the auth middleware. */
export type Env = {
  Bindings: Bindings;
  Variables: {
    userId: string;
    displayName: string;
    // Set alongside userId by requireAuth / requireSession / sessionMiddleware;
    // undefined only where no auth middleware ran (public routes).
    authMethod?: AuthMethod;
    // PAT grants; [] for sessions ("not scope-limited" — requireScope lets
    // every session through and judges only PATs).
    scopes?: Scope[];
  };
};
