// Everything the e2e run must agree on, in one place. Imported by
// playwright.config.ts and the specs (Playwright's own TS loader), by
// helpers/db.ts, and by prepare-config.ts, which plain `node` runs — that is
// why that file's specifier carries the ".ts" extension (Node's type stripping
// needs it).
//
// Two values are ALSO spelled out in package.json `e2e:server` (the
// --persist-to dir and the --ip/--port flags): keep them in sync.

/** Port of the e2e Worker. NOT vite dev's 5173 — both can run at once. */
export const E2E_PORT = 5183;

/**
 * The browser opens `localhost`, never `127.0.0.1`: a WebAuthn RP ID must be a
 * domain name (RP_ID=localhost), while the server only BINDS the literal IP
 * (skill playwright-e2e-in-docker-sandbox, Trap 2). ORIGIN is byte-identical to
 * this string — the CSRF Origin check and @simplewebauthn's expectedOrigin both
 * compare exactly, port included.
 */
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;
export const E2E_BIND_IP = "127.0.0.1";

/**
 * Own state dir, cwd-relative (apps/web). e2e empties its D1 on every run and
 * must never touch the `pnpm dev` database in .wrangler/state. The server and
 * every helper command point here, which is what keeps the skill's Trap 2
 * (`wrangler dev --config dist/...` defaulting to a dist-relative, empty D1)
 * closed.
 */
export const E2E_PERSIST_DIR = ".wrangler/e2e";

/** Typed into the register form; the same value opens the door server-side. */
export const E2E_INITIAL_REGISTRATION_TOKEN = "e2e-initial-token";

/**
 * Worker vars for the e2e server. They REPLACE the production RP_ID/ORIGIN
 * pinned in wrangler.jsonc — in the derived dist config only, never in
 * wrangler.jsonc itself. Test-only values by design (this file is public):
 * SESSION_SECRET merely clears the 32-char floor, BODY_KEY is base64 of the
 * ASCII "e2e-body-key-not-a-secret-32byte". Deliberately no DEV_CSP: e2e
 * asserts the production CSP.
 */
export const E2E_VARS = {
  RP_ID: "localhost",
  ORIGIN: E2E_ORIGIN,
  SESSION_SECRET: "e2e-session-secret-0123456789abcdef0123456789abcdef",
  INITIAL_REGISTRATION_TOKEN: E2E_INITIAL_REGISTRATION_TOKEN,
  BODY_KEY: "ZTJlLWJvZHkta2V5LW5vdC1hLXNlY3JldC0zMmJ5dGU=",
} as const;
