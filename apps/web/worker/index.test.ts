import { describe, expect, it } from "vitest";
import { app } from "./index";
import { testEnv } from "./test-support";

describe("GET /health", () => {
  it("returns 200 with {status: 'ok'}", async () => {
    const res = await app.request("/health", {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
