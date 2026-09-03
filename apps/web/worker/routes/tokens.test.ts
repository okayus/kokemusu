import { describe, expect, it } from "vitest";
import { app } from "../index";
import { TEST_ORIGIN, testEnv } from "../test-support";
import { createTokenSchema } from "./tokens";

// The Node harness has no D1 (test-support.ts), so these stay on the paths
// that answer BEFORE the database: mount order, CSRF, the auth gates and the
// cheap PAT rejects. The full mint → Bearer → revoke round-trip is e2e
// (e2e/pat.spec.ts) territory.

const errType = async (res: Response) =>
  ((await res.json()) as { error: { type: string } }).error.type;

describe("token management sits behind the auth gates", () => {
  it("GET /api/tokens without a session is 401 (mounted, gated)", async () => {
    const res = await app.request("/api/tokens", {}, testEnv());
    expect(res.status).toBe(401);
    expect(await errType(res)).toBe("unauthorized");
  });

  it("POST /api/tokens without a session is 401", async () => {
    const res = await app.request(
      "/api/tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
        body: JSON.stringify({ name: "cli" }),
      },
      testEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("DELETE /api/tokens/:id without a session is 401", async () => {
    const res = await app.request(
      "/api/tokens/some-id",
      { method: "DELETE", headers: { Origin: TEST_ORIGIN } },
      testEnv(),
    );
    expect(res.status).toBe(401);
  });

  // With no PAT_PEPPER configured no PAT can be valid, so even a well-formed
  // Bearer dies before hashing or D1 (fail closed) — as a plain 401, since the
  // request then has no usable credential at all.
  it("a Bearer request cannot reach token management while PAT_PEPPER is unset", async () => {
    const res = await app.request(
      "/api/tokens",
      { method: "POST", headers: { Authorization: "Bearer kokemusu_pat_wellformed-but-dead" } },
      testEnv(),
    );
    expect(res.status).toBe(401);
  });
});

describe("createTokenSchema", () => {
  it("accepts a plain name and trims it", () => {
    const parsed = createTokenSchema.safeParse({ name: "  mazuoboeru  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe("mazuoboeru");
  });

  it("rejects a missing, empty or whitespace-only name", () => {
    expect(createTokenSchema.safeParse({}).success).toBe(false);
    expect(createTokenSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createTokenSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects an oversized name", () => {
    expect(createTokenSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
  });
});
