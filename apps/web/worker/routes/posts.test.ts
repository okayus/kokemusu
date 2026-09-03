import { describe, expect, it } from "vitest";
import { app } from "../index";
import { TEST_ORIGIN, testEnv } from "../test-support";
import { createPostSchema, listPostsQuerySchema } from "./posts";

// The Node harness has no D1 (test-support.ts), so these route tests stay on
// the paths that fail BEFORE the database: mount order, CSRF, the session
// guard. Validation is covered on the exported schemas directly; the full
// write/read round-trip belongs to e2e (PR6) and the production DoD check.

const postJson = (path: string, body: unknown) =>
  app.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
      body: JSON.stringify(body),
    },
    testEnv(),
  );

describe("posts/tags routes sit behind the session guard", () => {
  it("POST /api/posts without a session is 401 (not 404 — the route is mounted)", async () => {
    const res = await postJson("/api/posts", { body: "苔" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("unauthorized");
  });

  it("GET /api/posts without a session is 401", async () => {
    const res = await app.request("/api/posts", {}, testEnv());
    expect(res.status).toBe(401);
  });

  it("GET /api/tags without a session is 401", async () => {
    const res = await app.request("/api/tags", {}, testEnv());
    expect(res.status).toBe(401);
  });

  it("a cross-origin POST /api/posts is rejected by CSRF before anything else", async () => {
    const res = await app.request(
      "/api/posts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ body: "苔" }),
      },
      testEnv(),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe(
      "csrf_origin_mismatch",
    );
  });

  // PAT boundary (features.md §7): the harness has no DB, so reaching D1 would
  // crash as a 500 — the clean 401 is positive proof that a Bearer token
  // without the kokemusu_pat_ prefix is rejected on a string compare, before
  // any hashing or database read, even with a pepper configured.
  it("junk Bearer without the PAT prefix dies before D1 (401, pepper set)", async () => {
    const res = await app.request(
      "/api/posts",
      {
        method: "POST",
        headers: { Authorization: "Bearer some-other-apps-token" },
      },
      testEnv({ PAT_PEPPER: "unit-test-pat-pepper-0123456789abcdef" }),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("unauthorized");
  });
});

describe("API responses are marked no-store (decrypted bodies must not be cached)", () => {
  it("sets Cache-Control: no-store on /api/* responses", async () => {
    const res = await app.request("/api/posts", {}, testEnv());
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaves non-API responses alone", async () => {
    const res = await app.request("/health", {}, testEnv());
    expect(res.headers.get("Cache-Control")).toBeNull();
  });
});

describe("createPostSchema", () => {
  it("accepts a minimal body and the full shape", () => {
    expect(createPostSchema.safeParse({ body: "苔" }).success).toBe(true);
    expect(
      createPostSchema.safeParse({
        body: "本文",
        title: "見出し",
        tags: ["typescript", "苔"],
      }).success,
    ).toBe(true);
  });

  it("rejects a missing, empty or whitespace-only body", () => {
    expect(createPostSchema.safeParse({}).success).toBe(false);
    expect(createPostSchema.safeParse({ body: "" }).success).toBe(false);
    expect(createPostSchema.safeParse({ body: "   \n　" }).success).toBe(false);
  });

  it("rejects oversized fields", () => {
    expect(createPostSchema.safeParse({ body: "x".repeat(20_001) }).success).toBe(false);
    expect(createPostSchema.safeParse({ body: "x", title: "t".repeat(201) }).success).toBe(false);
    expect(createPostSchema.safeParse({ body: "x", tags: ["y".repeat(101)] }).success).toBe(false);
  });

  it("rejects too many tags and an empty tag string", () => {
    expect(
      createPostSchema.safeParse({ body: "x", tags: Array.from({ length: 21 }, () => "t") })
        .success,
    ).toBe(false);
    expect(createPostSchema.safeParse({ body: "x", tags: [""] }).success).toBe(false);
  });
});

describe("listPostsQuerySchema", () => {
  it("defaults limit to 20 when absent", () => {
    const parsed = listPostsQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(20);
  });

  it("coerces the limit query string and enforces 1..50 integers", () => {
    const ok = listPostsQuerySchema.safeParse({ limit: "50" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.limit).toBe(50);
    expect(listPostsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(listPostsQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
    expect(listPostsQuerySchema.safeParse({ limit: "2.5" }).success).toBe(false);
    expect(listPostsQuerySchema.safeParse({ limit: "abc" }).success).toBe(false);
  });

  it("bounds cursor and tag strings", () => {
    expect(listPostsQuerySchema.safeParse({ cursor: "x".repeat(257) }).success).toBe(false);
    expect(listPostsQuerySchema.safeParse({ tag: "" }).success).toBe(false);
    expect(listPostsQuerySchema.safeParse({ cursor: "abc", tag: "苔" }).success).toBe(true);
  });

  it("accepts a ?tags= AND set, alone or with a cursor", () => {
    expect(listPostsQuerySchema.safeParse({ tags: "id-a,id-b" }).success).toBe(true);
    expect(listPostsQuerySchema.safeParse({ cursor: "abc", tags: "id-a,id-b" }).success).toBe(true);
    expect(listPostsQuerySchema.safeParse({ tags: "" }).success).toBe(false);
    expect(listPostsQuerySchema.safeParse({ tags: "a,".repeat(700) + "b" }).success).toBe(false);
  });

  it("rejects tag and tags together — a mixed request has no meaning", () => {
    expect(listPostsQuerySchema.safeParse({ tag: "苔", tags: "id-a,id-b" }).success).toBe(false);
  });
});
