import { describe, expect, it } from "vitest";
import { app } from "../index";
import { TEST_ORIGIN, testEnv } from "../test-support";

const begin = (env: ReturnType<typeof testEnv>, ip?: string) =>
  app.request(
    "/api/auth/login/begin",
    {
      method: "POST",
      headers: { Origin: TEST_ORIGIN, ...(ip === undefined ? {} : { "CF-Connecting-IP": ip }) },
    },
    env,
  );

describe("authRateLimit", () => {
  it("fails OPEN when the binding is absent (local dev / e2e config)", async () => {
    const res = await begin(testEnv());
    expect(res.status).toBe(200);
  });

  it("returns 429 rate_limited when the limiter says no", async () => {
    const keys: string[] = [];
    const env = testEnv({
      AUTH_RATE_LIMITER: {
        limit: ({ key }: { key: string }) => {
          keys.push(key);
          return Promise.resolve({ success: false });
        },
      } as unknown as RateLimit,
    });
    const res = await begin(env, "203.0.113.7");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { type: "rate_limited" } });
    // Keyed per client IP.
    expect(keys).toEqual(["203.0.113.7"]);
  });

  it("lets the request through when the limiter says yes", async () => {
    const env = testEnv({
      AUTH_RATE_LIMITER: {
        limit: () => Promise.resolve({ success: true }),
      } as unknown as RateLimit,
    });
    const res = await begin(env);
    expect(res.status).toBe(200);
  });
});
