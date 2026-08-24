import { describe, expect, it } from "vitest";
import { app } from "../index";
import { testEnv } from "../test-support";

const PROD_ENV = testEnv({
  RP_ID: "kokemusu.shiraoka.workers.dev",
  ORIGIN: "https://kokemusu.shiraoka.workers.dev",
});

describe("securityHeaders", () => {
  it("production: strict CSP, HSTS, and the header set on /health", async () => {
    const res = await app.request("/health", {}, PROD_ENV);
    expect(res.status).toBe(200);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("DEV_CSP=1 relaxes only the vite-dev directives and only over http", async () => {
    const res = await app.request("/health", {}, testEnv({ DEV_CSP: "1" }));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    // http origin -> no HSTS.
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("e2e shape (http, no DEV_CSP): the production CSP without HSTS", async () => {
    const res = await app.request(
      "/health",
      {},
      testEnv({ ORIGIN: "http://127.0.0.1:5399" }),
    );
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("the SPA fallback response carries the headers too", async () => {
    const res = await app.request("/some/client/route", {}, PROD_ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });
});
