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
});
