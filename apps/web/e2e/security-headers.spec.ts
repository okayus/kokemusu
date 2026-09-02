import { expect, test } from "@playwright/test";

// Middleware wiring, as shipped: the SPA HTML (run_worker_first → notFound →
// ASSETS), a client-side route, an API 401 and /health all carry the header set,
// and the CSP is the STRICT production one — no 'unsafe-inline', which is also
// the proof that e2e looks at the build artifact and not at vite dev / DEV_CSP.
// e2e runs over http, so HSTS must be absent here; its https form is fixed by
// worker/middleware/security-headers.test.ts.
for (const path of ["/", "/some/client/route", "/health", "/api/auth/me"]) {
  test(`security headers on ${path}`, async ({ request }) => {
    const res = await request.get(path);
    const h = res.headers();
    const csp = h["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/(^|;\s*)script-src 'self'(;|$)/);
    expect(csp).toMatch(/(^|;\s*)style-src 'self'(;|$)/);
    expect(csp).toMatch(/(^|;\s*)connect-src 'self'(;|$)/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["strict-transport-security"]).toBeUndefined();
  });
}

test("each surface answers with its own content type; /api is never cached", async ({
  request,
}) => {
  const spa = await request.get("/");
  expect(spa.status()).toBe(200);
  expect(spa.headers()["content-type"]).toContain("text/html");
  // L1–L3 of the SPA routing: an unknown non-API path is index.html, not a 404.
  const fallback = await request.get("/some/client/route");
  expect(fallback.status()).toBe(200);
  expect(fallback.headers()["content-type"]).toContain("text/html");
  const health = await request.get("/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  // Decrypted bodies ride on /api — no browser or proxy may keep a copy.
  const api = await request.get("/api/auth/me");
  expect(api.status()).toBe(401);
  expect(api.headers()["cache-control"]).toBe("no-store");
});

test("a non-GET /api request without a matching Origin is refused", async ({ request }) => {
  const foreign = await request.post("/api/auth/login/begin", {
    headers: { Origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);
  expect(await foreign.json()).toEqual({ error: { type: "csrf_origin_mismatch" } });
  const missing = await request.post("/api/auth/login/begin");
  expect(missing.status()).toBe(403);
});
