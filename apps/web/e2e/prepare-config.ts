// Runs after `pnpm build` and before `wrangler dev` (package.json `e2e:server`):
// rewrites the DERIVED config the Cloudflare vite plugin emitted into
// dist/kokemusu/ so that a credential-free, firewalled sandbox can serve it.
// wrangler.jsonc is never touched, and `pnpm build` regenerates the derived
// file, so nothing done here can reach a deploy (Workers Builds and `pnpm
// deploy` both build first).
//
// Executed as plain `node e2e/prepare-config.ts` — Node 24 strips the types,
// which is why the local import below carries the ".ts" extension.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { E2E_BIND_IP, E2E_PORT, E2E_VARS } from "./env.ts";

const bundleDir = fileURLToPath(new URL("../dist/kokemusu/", import.meta.url));
const configPath = `${bundleDir}wrangler.json`;
const cfg = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;

// Trap 1 (skill playwright-e2e-in-docker-sandbox): a rate-limit binding makes
// `wrangler dev` proxy to a remote Cloudflare resource whose handshake never
// completes without credentials, and every request hangs. The middleware fails
// OPEN without the binding (worker/middleware/rate-limit.ts), and rate limiting
// is out of e2e scope, so nothing of value is lost.
delete cfg["ratelimits"];
delete cfg["unsafe"];

// Trap 2: a `localhost` bind stalls on IPv4/IPv6 resolution in the container.
// `e2e:server` passes the same --ip/--port; pinned here as well so a flag-less
// `wrangler dev --config dist/kokemusu/wrangler.json` stays consistent.
cfg["dev"] = {
  ...(cfg["dev"] as Record<string, unknown> | undefined),
  ip: E2E_BIND_IP,
  port: E2E_PORT,
};

// The e2e relying party and secrets (test-only values, see env.ts).
cfg["vars"] = E2E_VARS;

writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);

// The plugin copies apps/web/.dev.vars next to the derived config, and wrangler
// reads .dev.vars from the config's own directory — where it would override the
// `vars` above with the developer's values (DEV_CSP=1, ORIGIN on port 5273 →
// relaxed CSP, 403 on every POST, challenge_mismatch on verify). Remove the
// copy so the e2e Worker sees exactly E2E_VARS.
const copiedDevVars = `${bundleDir}.dev.vars`;
if (existsSync(copiedDevVars)) rmSync(copiedDevVars);

console.log(
  `e2e: prepared ${configPath} — ratelimits stripped, dev ${E2E_BIND_IP}:${E2E_PORT}, e2e vars, .dev.vars copy removed`,
);
