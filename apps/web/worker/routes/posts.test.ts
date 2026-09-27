import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { MAX_TAGS_PER_POST, MAX_TAGS_PER_SET } from "../core/tag";
import { createDb } from "../db";
import { app } from "../index";
import { TEST_ORIGIN, testEnv } from "../test-support";
import {
  createPostSchema,
  feedCondition,
  feedFilterSchema,
  listPostsQuerySchema,
  periodCondition,
  retagFilterSchema,
  retagSchema,
  retagStatements,
} from "./posts";

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

  // 付け替え and its count (features.md §2): mounted, session-only. The
  // collection PATCH carries no body here — the guard answers before reading.
  it("GET /api/posts/count without a session is 401 (not 404 — the route is mounted)", async () => {
    const res = await app.request("/api/posts/count?tag=苔", {}, testEnv());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("unauthorized");
  });

  it("PATCH /api/posts (the collection, 付け替え) without a session is 401", async () => {
    const res = await app.request(
      "/api/posts?tag=苔",
      { method: "PATCH", headers: { Origin: TEST_ORIGIN } },
      testEnv(),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("unauthorized");
  });

  it("a cross-origin PATCH /api/posts is rejected by CSRF before anything else", async () => {
    const res = await app.request(
      "/api/posts?tag=苔",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ add: ["typescript"] }),
      },
      testEnv(),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe(
      "csrf_origin_mismatch",
    );
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
        tags: ["typescript", "苔"],
        kind: "input",
        firstDay: "2026-09-01",
        lastDay: "2026-09-05",
        thickness: 60,
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
    expect(createPostSchema.safeParse({ body: "x", tags: ["y".repeat(101)] }).success).toBe(false);
  });

  it("refuses a key it does not name — the retired 見出し included — rather than dropping it (ADR-0006)", () => {
    expect(createPostSchema.safeParse({ body: "x", title: "見出し" }).success).toBe(false);
    expect(createPostSchema.safeParse({ body: "x", extra: 1 }).success).toBe(false);
  });

  it("takes MAX_TAGS_PER_POST tags, rejects one more and an empty tag string", () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    expect(createPostSchema.safeParse({ body: "x", tags: tags(MAX_TAGS_PER_POST) }).success).toBe(
      true,
    );
    expect(
      createPostSchema.safeParse({ body: "x", tags: tags(MAX_TAGS_PER_POST + 1) }).success,
    ).toBe(false);
    expect(createPostSchema.safeParse({ body: "x", tags: [""] }).success).toBe(false);
  });

  it("takes a 向き as one of the three words, null or nothing for 未分類, and no other spelling", () => {
    for (const kind of ["input", "output", "both", null]) {
      const parsed = createPostSchema.safeParse({ body: "x", kind });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.kind).toBe(kind);
    }
    expect(createPostSchema.safeParse({ body: "x" }).success).toBe(true);
    for (const kind of ["consume", "INPUT", "", 1, ["input"]]) {
      expect(createPostSchema.safeParse({ body: "x", kind }).success).toBe(false);
    }
  });

  // The days' ORDER and ceiling (first ≤ last ≤ today, the floor) are the
  // handler's, which knows today — core/stacking.ts `parseStacking` carries
  // that table. The schema's share is the spelling: calendar days or nothing.
  it("takes the days to stack on as calendar days — either, both, or neither", () => {
    expect(createPostSchema.safeParse({ body: "x", firstDay: "2026-09-05" }).success).toBe(true);
    expect(createPostSchema.safeParse({ body: "x", lastDay: "2026-09-05" }).success).toBe(true);
    const both = createPostSchema.safeParse({
      body: "x",
      firstDay: "2025-03-01",
      lastDay: "2026-01-31",
    });
    expect(both.success).toBe(true);
    if (both.success) {
      expect(both.data.firstDay).toBe("2025-03-01");
      expect(both.data.lastDay).toBe("2026-01-31");
    }
  });

  it("rejects a day the calendar does not have, or one not spelled YYYY-MM-DD", () => {
    for (const day of ["2026-02-30", "2026-13-01", "2026-9-5", "2026/09/05", "", "yesterday"]) {
      expect(createPostSchema.safeParse({ body: "x", firstDay: day }).success).toBe(false);
      expect(createPostSchema.safeParse({ body: "x", lastDay: day }).success).toBe(false);
    }
    expect(createPostSchema.safeParse({ body: "x", firstDay: null }).success).toBe(false);
    expect(createPostSchema.safeParse({ body: "x", firstDay: 20260905 }).success).toBe(false);
  });

  // What a 厚み MEANS with the days — a range must carry one, a single day
  // must not, PATCH's absent / null / number — is core's (stacking.test.ts).
  // The schema's share is the shape: a whole 1..100, null, or nothing.
  it("takes a 厚み as a whole 1..100, null or nothing, and no other spelling (ADR-0007)", () => {
    const range = { body: "x", firstDay: "2026-09-01", lastDay: "2026-09-05" };
    for (const thickness of [1, 60, 100, null]) {
      const parsed = createPostSchema.safeParse({ ...range, thickness });
      expect(parsed.success, String(thickness)).toBe(true);
      if (parsed.success) expect(parsed.data.thickness).toBe(thickness);
    }
    const absent = createPostSchema.safeParse(range);
    expect(absent.success).toBe(true);
    if (absent.success) expect(absent.data.thickness).toBeUndefined();
    for (const thickness of [0, 101, 60.5, -1, "60", "", true, [60], {}]) {
      expect(createPostSchema.safeParse({ ...range, thickness }).success, String(thickness)).toBe(
        false,
      );
    }
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

  it("rejects the last day of the 4-digit calendar as `to` — the wire has said 400 there since #37", () => {
    expect(listPostsQuerySchema.safeParse({ to: "9999-12-31" }).success).toBe(false);
    expect(listPostsQuerySchema.safeParse({ from: "9999-12-31" }).success).toBe(true);
  });
});

describe("periodCondition — the period is an overlap on the day axis (ADR-0005)", () => {
  const render = (query: { from?: string; to?: string }) => {
    const cond = periodCondition(query);
    return cond === undefined ? undefined : new SQLiteSyncDialect().sqlToQuery(cond);
  };

  it("meets `from` with last_day and `to` with first_day — a 苔片 there on any day of the period is in", () => {
    const q = render({ from: "2026-09-01", to: "2026-09-30" });
    expect(q?.sql).toMatch(/"last_day" >= \?/);
    expect(q?.sql).toMatch(/"first_day" <= \?/);
    expect(q?.params).toEqual(["2026-09-01", "2026-09-30"]);
  });

  it("leaves an absent half unbounded, and is no condition at all when both are absent", () => {
    const fromOnly = render({ from: "2026-09-01" });
    expect(fromOnly?.sql).toContain("last_day");
    expect(fromOnly?.sql).not.toContain("first_day");
    const toOnly = render({ to: "2026-09-30" });
    expect(toOnly?.sql).toContain("first_day");
    expect(toOnly?.sql).not.toContain("last_day");
    expect(render({})).toBeUndefined();
  });
});

describe("feedFilterSchema / retagFilterSchema — the filter three routes share", () => {
  it("the feed's filter takes stones and a period, or nothing; 付け替え's insists on a stone", () => {
    expect(feedFilterSchema.safeParse({}).success).toBe(true);
    expect(feedFilterSchema.safeParse({ from: "2026-09-01" }).success).toBe(true);
    expect(retagFilterSchema.safeParse({}).success).toBe(false);
    expect(retagFilterSchema.safeParse({ from: "2026-09-01", to: "2026-09-30" }).success).toBe(
      false,
    );
    expect(retagFilterSchema.safeParse({ tag: "TS" }).success).toBe(true);
    expect(retagFilterSchema.safeParse({ tags: "id-a,id-b", from: "2026-09-01" }).success).toBe(
      true,
    );
  });

  it("keeps the feed's rules — tag/tags exclusive, an ordered period — under the extra one", () => {
    expect(retagFilterSchema.safeParse({ tag: "TS", tags: "id-a,id-b" }).success).toBe(false);
    expect(
      retagFilterSchema.safeParse({ tag: "TS", from: "2026-09-30", to: "2026-09-01" }).success,
    ).toBe(false);
    expect(retagFilterSchema.safeParse({ tag: "TS", to: "9999-12-31" }).success).toBe(false);
    // Refining did not touch the feed's own schema.
    expect(feedFilterSchema.safeParse({ from: "2026-09-01" }).success).toBe(true);
  });

  it("the page's schema is the filter plus limit and cursor, rules kept", () => {
    expect(listPostsQuerySchema.safeParse({ tag: "TS", tags: "id-a,id-b" }).success).toBe(false);
    expect(listPostsQuerySchema.safeParse({ tag: "TS", limit: "5", cursor: "c" }).success).toBe(
      true,
    );
  });
});

describe("retagSchema — the change of a 付け替え", () => {
  it("takes stones to put on by name, stones to take off by id, either or both", () => {
    expect(retagSchema.safeParse({ add: ["typescript"] }).success).toBe(true);
    expect(retagSchema.safeParse({ remove: ["id-a"] }).success).toBe(true);
    expect(retagSchema.safeParse({ add: ["typescript"], remove: ["id-a"] }).success).toBe(true);
  });

  it("refuses nothing to change, a blank stone, and a key it does not name (ADR-0006)", () => {
    expect(retagSchema.safeParse({}).success).toBe(false);
    expect(retagSchema.safeParse({ add: [], remove: [] }).success).toBe(false);
    expect(retagSchema.safeParse({ add: [""] }).success).toBe(false);
    expect(retagSchema.safeParse({ add: "typescript" }).success).toBe(false);
    expect(retagSchema.safeParse({ add: ["x"], tags: ["y"] }).success).toBe(false);
    expect(retagSchema.safeParse({ add: ["x"], title: "見出し" }).success).toBe(false);
  });

  it("caps the sides where the composer and the ?tags= set are capped", () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    expect(retagSchema.safeParse({ add: names(MAX_TAGS_PER_POST) }).success).toBe(true);
    expect(retagSchema.safeParse({ add: names(MAX_TAGS_PER_POST + 1) }).success).toBe(false);
    expect(retagSchema.safeParse({ remove: names(MAX_TAGS_PER_SET) }).success).toBe(true);
    expect(retagSchema.safeParse({ remove: names(MAX_TAGS_PER_SET + 1) }).success).toBe(false);
    expect(retagSchema.safeParse({ remove: ["x".repeat(65)] }).success).toBe(false);
  });
});

describe("feedCondition — the filter as SQL, a subquery so writes can go through it", () => {
  // No D1 behind it: the builders only render.
  const db = createDb(undefined as unknown as D1Database);
  const render = (stones: string[], period: { from?: string; to?: string }) =>
    new SQLiteSyncDialect().sqlToQuery(feedCondition(db, "u", stones, period));

  it("no stone is the user alone (with the period's overlap when there is one)", () => {
    expect(render([], {})).toMatchObject({ sql: '"post"."user_id" = ?', params: ["u"] });
    const q = render([], { from: "2026-09-01", to: "2026-09-30" });
    expect(q.sql).toMatch(/"last_day" >= \? and "post"."first_day" <= \?/);
    expect(q.params).toEqual(["u", "2026-09-01", "2026-09-30"]);
  });

  it("one stone is a plain IN over post_tags, never a join", () => {
    const q = render(["t1"], {});
    expect(q.sql).toBe(
      '("post"."user_id" = ? and "post"."id" in (select "post_id" from "post_tags" where "post_tags"."tag_id" = ?))',
    );
    expect(q.params).toEqual(["u", "t1"]);
  });

  it("a set is the 年表's AND — post ids carrying COUNT(DISTINCT tag_id ∈ set) = n", () => {
    const q = render(["t1", "t2"], { from: "2026-09-01" });
    expect(q.sql).toBe(
      '("post"."user_id" = ? and "post"."id" in (select "post_id" from "post_tags" where "post_tags"."tag_id" in (?, ?) group by "post_tags"."post_id" having count(distinct "post_tags"."tag_id") = ?) and "post"."last_day" >= ?)',
    );
    expect(q.params).toEqual(["u", "t1", "t2", 2, "2026-09-01"]);
  });
});

describe("retagStatements — every statement writes THROUGH the filter (features.md §2)", () => {
  const db = createDb(undefined as unknown as D1Database);
  const cond = feedCondition(db, "u", ["t1"], { from: "2026-09-01" });
  const filterSql =
    '("post"."user_id" = ? and "post"."id" in (select "post_id" from "post_tags" where "post_tags"."tag_id" = ?) and "post"."last_day" >= ?)';
  const filterParams = ["u", "t1", "2026-09-01"];

  it("counts, touches the changed, mints new stones, puts links on, takes links off — in that order", () => {
    const stmts = retagStatements(db, {
      cond,
      now: 1,
      newTags: [{ id: "n1", userId: "u", name: "New", norm: "new", createdAt: 1 }],
      addIds: ["n1", "t2"],
      removeIds: ["t1"],
    }).map((s) => s.toSQL());
    expect(stmts.map((s) => s.sql.split(" ")[0])).toEqual([
      "select",
      "update",
      "insert",
      "insert",
      "insert",
      "delete",
    ]);
    expect(stmts[0]).toEqual({
      sql: `select count(*) from "post" where ${filterSql}`,
      params: filterParams,
    });
    // A new stone is on no 苔片 yet: every matched 苔片 changes, no condition.
    expect(stmts[1]).toEqual({
      sql: `update "post" set "updated_at" = ? where ${filterSql}`,
      params: [1, ...filterParams],
    });
    expect(stmts[2]?.sql).toMatch(/^insert into "tag" /);
    // INSERT … SELECT: the 苔片 of the filter, each with the stone — OR IGNORE
    // for one that wears it already (the PK).
    expect(stmts[3]).toEqual({
      sql: `insert into "post_tags" ("post_id", "tag_id") select "id", ? as "tag_id" from "post" where ${filterSql} on conflict do nothing`,
      params: ["n1", ...filterParams],
    });
    expect(stmts[4]?.params).toEqual(["t2", ...filterParams]);
    // DELETE through the filter: the 苔片 of the filter as it stands when the
    // statement runs — after the links above were put on.
    expect(stmts[5]).toEqual({
      sql: `delete from "post_tags" where ("post_tags"."tag_id" = ? and "post_tags"."post_id" in (select "id" from "post" where ${filterSql}))`,
      params: ["t1", ...filterParams],
    });
  });

  it("with no new stone, the touch names exactly the 苔片 whose links will change", () => {
    const [, touch] = retagStatements(db, {
      cond,
      now: 1,
      newTags: [],
      addIds: ["t2"],
      removeIds: ["t1"],
    });
    const q = touch.toSQL();
    expect(q.sql).toBe(
      `update "post" set "updated_at" = ? where (${filterSql} and (not exists (select 1 from "post_tags" where ("post_tags"."post_id" = "post"."id" and "post_tags"."tag_id" = ?)) or exists (select 1 from "post_tags" where ("post_tags"."post_id" = "post"."id" and "post_tags"."tag_id" = ?))))`,
    );
    expect(q.params).toEqual([1, ...filterParams, "t2", "t1"]);
  });

  it("binds the filter and the stone, however many 苔片 the filter holds", () => {
    const stmts = retagStatements(db, {
      cond: feedCondition(db, "u", Array.from({ length: MAX_TAGS_PER_SET }, (_, i) => `s${i}`), {
        from: "2026-01-01",
        to: "2026-12-31",
      }),
      now: 1,
      newTags: [],
      addIds: ["a1"],
      removeIds: ["s0"],
    });
    // The widest statement: the touch, with the set twice over (not exists /
    // exists once each) — under D1's 100 bound parameters per statement.
    const widest = Math.max(...stmts.map((s) => s.toSQL().params.length));
    expect(widest).toBeLessThan(100);
  });
});
