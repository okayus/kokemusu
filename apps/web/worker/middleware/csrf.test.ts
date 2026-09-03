import { describe, expect, it } from "vitest";
import { app } from "../index";
import { TEST_ORIGIN, testEnv } from "../test-support";

const post = (origin?: string) =>
  app.request(
    "/api/auth/login/begin",
    {
      method: "POST",
      headers: origin === undefined ? {} : { Origin: origin },
    },
    testEnv(),
  );

describe("csrfOriginCheck", () => {
  it("rejects a non-GET /api request without an Origin header", async () => {
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { type: "csrf_origin_mismatch" } });
  });

  it("rejects a non-GET /api request from a foreign origin", async () => {
    const res = await post("https://evil.example");
    expect(res.status).toBe(403);
  });

  it("passes when Origin equals ORIGIN", async () => {
    const res = await post(TEST_ORIGIN);
    expect(res.status).toBe(200);
  });

  it("exempts GET (the session middleware answers instead)", async () => {
    const res = await app.request("/api/auth/me", {}, testEnv());
    expect(res.status).toBe(401);
  });

  // The PAT exemption (features.md §7): a Bearer request carries no ambient
  // cookie a cross-site page could forge, so the Origin requirement is skipped
  // on the header's PRESENCE. testEnv has no PAT_PEPPER, so validatePat says
  // null before any hashing or D1 — the request then dies at requireAuth as a
  // plain 401, which is exactly the "invalid token past CSRF" contract.
  it("a Bearer request without an Origin gets past CSRF and fails at auth (401, not 403)", async () => {
    const res = await app.request(
      "/api/posts",
      { method: "POST", headers: { Authorization: "Bearer kokemusu_pat_not-a-real-token" } },
      testEnv(),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { type: "unauthorized" } });
  });

  it("only the Bearer scheme is exempt — other Authorization schemes still need Origin", async () => {
    const res = await app.request(
      "/api/posts",
      { method: "POST", headers: { Authorization: "Basic dXNlcjpwdw==" } },
      testEnv(),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { type: "csrf_origin_mismatch" } });
  });
});
