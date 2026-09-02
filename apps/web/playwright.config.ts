import { defineConfig, devices } from "@playwright/test";
import { E2E_ORIGIN } from "./e2e/env";

// e2e runs against the BUILD ARTIFACT served by `wrangler dev`, never `vite dev`
// (skill cloudflare-workers-e2e-playwright). Do not "simplify" this back:
//
// - vite dev injects React Fast Refresh's inline <script> into every HTML
//   response, and the production CSP (script-src 'self') blocks it before React
//   mounts. Relaxing the CSP for the run (DEV_CSP=1 exists for `pnpm dev`) would
//   make e2e assert a CSP production never sends. The build output has no
//   inline script, so the strict CSP is exactly what is exercised.
// - `wrangler dev --config dist/kokemusu/wrangler.json` resolves .wrangler state
//   relative to the config's directory — a fresh, empty D1 — unless
//   `--persist-to` pins it. e2e pins its OWN dir (.wrangler/e2e, e2e/env.ts) so
//   a run never wipes the `pnpm dev` database; global-setup migrates and empties
//   that dir.
// - Sandbox (skill playwright-e2e-in-docker-sandbox): e2e/prepare-config.ts
//   strips the rate-limit binding from the derived config (its remote handshake
//   never completes credential-free and hangs every request) and pins the bind
//   to 127.0.0.1 (a `localhost` bind stalls on dual-stack resolution). The
//   browser still opens `localhost` — an RP ID must be a domain name.
//   Chromium's own sandbox cannot initialise without SYS_ADMIN, so --no-sandbox
//   is passed ONLY when the DEVCONTAINER marker (.docker/Dockerfile) is set; a
//   host run keeps the real browser sandbox.
// - Not run in CI, on purpose: the WebAuthn virtual authenticator is not stable
//   across headless Chromium versions on CI runners, and one flaky required check
//   blocks every merge. `pnpm check` type-checks the specs in CI; run `pnpm e2e`
//   in the container before merging. Revisit if a regression ever slips past.
//
// Own port (5183): `pnpm dev` (5173) and `pnpm e2e:server` can run side by side.

export default defineConfig({
  testDir: "./e2e",
  // One local sqlite, one virtual authenticator: serial by construction.
  fullyParallel: false,
  workers: 1,
  // A flaky e2e is a bug report, not something to retry past.
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env["DEVCONTAINER"] ? { args: ["--no-sandbox"] } : {},
  },
  webServer: {
    command: "pnpm run e2e:server",
    url: `${E2E_ORIGIN}/health`,
    // Start `pnpm e2e:server` once in another shell; later `pnpm e2e` runs skip the rebuild.
    reuseExistingServer: true,
    // build + prepare + wrangler dev start-up, with headroom for a cold container.
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
