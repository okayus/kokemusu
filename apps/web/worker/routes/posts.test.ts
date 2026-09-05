import { describe, expect, it } from "vitest";
import { app } from "../index";
import { TEST_ORIGIN, testEnv } from "../test-support";
import { createPostSchema, listPostsQuerySchema, resolvePeriod } from "./posts";

const HOUR = 3_600_000;

/** The instant a JST wall-clock reading names. JST is UTC+9 flat — no DST, ever. */
const jst = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi) - 9 * HOUR;

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

  // Edit/delete (ADR-0003): mounted, and dead without a cookie session before
  // any of the handler runs. The session-only wall against a live PAT needs a
  // DB and lives in e2e (pat.spec.ts).
  it("PATCH /api/posts/:id without a session is 401 (not 404 — the route is mounted)", async () => {
    const res = await app.request(
      "/api/posts/some-id",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
        body: JSON.stringify({ body: "苔" }),
      },
      testEnv(),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("unauthorized");
  });

  it("DELETE /api/posts/:id without a session is 401", async () => {
    const res = await app.request(
      "/api/posts/some-id",
      { method: "DELETE", headers: { Origin: TEST_ORIGIN } },
      testEnv(),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("unauthorized");
  });

  it("a cross-origin PATCH /api/posts/:id is rejected by CSRF before anything else", async () => {
    const res = await app.request(
      "/api/posts/some-id",
      {
        method: "PATCH",
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

  it("accepts a period as calendar days — either half alone, or both", () => {
    expect(listPostsQuerySchema.safeParse({ from: "2026-09-01" }).success).toBe(true);
    expect(listPostsQuerySchema.safeParse({ to: "2026-09-30" }).success).toBe(true);
    expect(
      listPostsQuerySchema.safeParse({ from: "2026-09-01", to: "2026-09-30" }).success,
    ).toBe(true);
    // One day is a range too, and the period composes with every other filter.
    expect(
      listPostsQuerySchema.safeParse({ from: "2026-09-05", to: "2026-09-05" }).success,
    ).toBe(true);
    expect(
      listPostsQuerySchema.safeParse({
        cursor: "abc",
        tags: "id-a,id-b",
        from: "2026-09-01",
        to: "2026-09-30",
      }).success,
    ).toBe(true);
  });

  it("rejects a day the calendar does not have, or one not spelled YYYY-MM-DD", () => {
    expect(listPostsQuerySchema.safeParse({ from: "2026-02-30" }).success).toBe(false);
    expect(listPostsQuerySchema.safeParse({ to: "2026-13-01" }).success).toBe(false);
    expect(listPostsQuerySchema.safeParse({ from: "2026-9-1" }).success).toBe(false);
    expect(listPostsQuerySchema.safeParse({ from: "" }).success).toBe(false);
    expect(listPostsQuerySchema.safeParse({ to: "2026-09-01T00:00:00Z" }).success).toBe(false);
  });

  it("rejects an inverted period", () => {
    expect(
      listPostsQuerySchema.safeParse({ from: "2026-09-30", to: "2026-09-01" }).success,
    ).toBe(false);
  });
});

describe("resolvePeriod — inclusive JST days become a half-open created_at window", () => {
  it("cuts both ends at JST midnight: the day after `to` is excluded from its first ms", () => {
    const bounds = resolvePeriod({ from: "2026-09-01", to: "2026-09-30" });
    expect(bounds).toEqual({ startMs: jst(2026, 9, 1), endMs: jst(2026, 10, 1) });
    // 00:30 JST on the 1st is still Aug 31 in UTC — SQLite's date() would file
    // it under August; this window opened 30 minutes before it.
    const firstNight = jst(2026, 9, 1, 0, 30);
    expect(new Date(firstNight).toISOString()).toBe("2026-08-31T15:30:00.000Z");
    expect(bounds?.startMs).toBeLessThanOrEqual(firstNight);
  });

  it("leaves an absent half unbounded", () => {
    expect(resolvePeriod({ from: "2026-09-01" })).toEqual({
      startMs: jst(2026, 9, 1),
      endMs: undefined,
    });
    expect(resolvePeriod({ to: "2026-09-01" })).toEqual({
      startMs: undefined,
      endMs: jst(2026, 9, 2),
    });
    expect(resolvePeriod({})).toEqual({ startMs: undefined, endMs: undefined });
  });

  it("refuses the last day of the 4-digit calendar — the day after it has no key", () => {
    expect(resolvePeriod({ to: "9999-12-31" })).toBeNull();
    expect(resolvePeriod({ from: "9999-12-31" })).not.toBeNull();
  });
});
