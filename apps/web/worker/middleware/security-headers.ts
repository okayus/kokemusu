import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import { isHttpsOrigin } from "../lib/cookies";
import type { Env } from "../types";

// hono's secureHeaders with two request-derived switches on top of the
// defaults (nosniff, Referrer-Policy: no-referrer, COOP/CORP, X-XSS-Protection
// 0, ...):
//
//  - CSP: strict `script-src 'self'` in production. `vite dev` injects an
//    inline HMR preamble into every HTML response, which a strict CSP blocks
//    before React can mount (skill cloudflare-workers-e2e-playwright) — so
//    DEV_CSP=1 (.dev.vars only) adds 'unsafe-inline' + ws: for HMR. e2e runs
//    against the build artifact WITHOUT DEV_CSP and asserts the real CSP.
//  - HSTS: only when ORIGIN is https — meaningless over http, and keeping it
//    scheme-derived means e2e on http://127.0.0.1 asserts its absence.
function buildCsp(dev: boolean) {
  return {
    defaultSrc: ["'self'"],
    // dev: the react-refresh preamble is an inline <script type="module">.
    scriptSrc: dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    // dev: vite injects imported CSS as inline <style> elements; the build
    // emits a real .css file, so production stays 'self'.
    styleSrc: dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    imgSrc: ["'self'", "data:"],
    // dev: the HMR websocket.
    connectSrc: dev ? ["'self'", "ws:", "wss:"] : ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  };
}

function build(dev: boolean, https: boolean): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: buildCsp(dev),
    strictTransportSecurity: https ? "max-age=31536000; includeSubDomains" : false,
    xFrameOptions: "DENY",
  });
}

// secureHeaders() precomputes its header list, so build each of the (at most
// four) env-derived variants once and dispatch per request.
const variants = new Map<string, MiddlewareHandler>();

export const securityHeaders = createMiddleware<Env>(async (c, next) => {
  const dev = c.env.DEV_CSP === "1";
  const https = isHttpsOrigin(c.env.ORIGIN);
  const key = `${dev}:${https}`;
  let mw = variants.get(key);
  if (!mw) {
    mw = build(dev, https);
    variants.set(key, mw);
  }
  return mw(c, next);
});
