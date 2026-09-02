import { describe, expect, it } from "vitest";
import { addDays } from "../core/day";
import { app } from "../index";
import { testEnv } from "../test-support";
import {
  MAX_WINDOW_DAYS,
  TIMELINE_MAX_TAGS,
  buildHeatmap,
  buildTagSpans,
  heatmapQuerySchema,
  parseTagsParam,
  resolveWindow,
  timelineQuerySchema,
} from "./stats";

// Same arrangement as posts.test.ts: the Node harness has no D1, so the route
// test stops at the session guard (mount proof) and validation + folding are
// exercised on the exported pieces directly. The full SQL round-trip belongs
// to e2e (PR6) and the production DoD 4 check.

const HOUR = 3_600_000;

/** The instant a JST wall-clock reading names. JST is UTC+9 flat — no DST, ever. */
const jst = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, s, ms) - 9 * HOUR;

// 2026-09-02 is a Wednesday.
const TODAY_MS = jst(2026, 9, 2, 12, 34);

describe("stats route sits behind the session guard", () => {
  it("GET /api/stats/heatmap without a session is 401 (not 404 — the route is mounted)", async () => {
    const res = await app.request("/api/stats/heatmap", {}, testEnv());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("unauthorized");
  });

  it("GET /api/stats/timeline without a session is 401 (not 404 — the route is mounted)", async () => {
    const res = await app.request("/api/stats/timeline", {}, testEnv());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("unauthorized");
  });
});

describe("heatmapQuerySchema", () => {
  it("accepts an empty query and the full shape", () => {
    expect(heatmapQuerySchema.safeParse({}).success).toBe(true);
    expect(heatmapQuerySchema.safeParse({ from: "2026-01-01", to: "2026-02-01" }).success).toBe(
      true,
    );
  });

  it("rejects anything that is not a calendar day", () => {
    expect(heatmapQuerySchema.safeParse({ from: "2026-9-2" }).success).toBe(false);
    expect(heatmapQuerySchema.safeParse({ from: "20260902" }).success).toBe(false);
    expect(heatmapQuerySchema.safeParse({ to: "2026-02-30" }).success).toBe(false);
    expect(heatmapQuerySchema.safeParse({ to: "2026-13-01" }).success).toBe(false);
    expect(heatmapQuerySchema.safeParse({ to: "2026-09-02T00:00" }).success).toBe(false);
  });

  it("has no tag field — the heatmap never splits by tag (visualization.md §1)", () => {
    // zod strips unknown keys rather than erroring; what matters is that a
    // stray ?tag= can't reach the query, so the parsed shape must not carry it.
    const parsed = heatmapQuerySchema.safeParse({ tag: "typescript" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({});
  });
});

describe("resolveWindow", () => {
  it("defaults to the GitHub-style 53 columns: Sunday 52 weeks back → today", () => {
    // 2025-08-31 is the Sunday opening the week 52 weeks before today's week.
    expect(resolveWindow({}, TODAY_MS)).toEqual({ from: "2025-08-31", to: "2026-09-02" });
  });

  it("snaps the default from to a Sunday whatever weekday `to` is", () => {
    // A Sunday `to` keeps a partial last column of exactly one day…
    expect(resolveWindow({ to: "2026-08-30" }, TODAY_MS)).toEqual({
      from: "2025-08-31",
      to: "2026-08-30",
    });
    // …and a Saturday `to` fills all 53 columns = the widest default window,
    // exactly MAX_WINDOW_DAYS (371) days.
    expect(resolveWindow({ to: "2026-09-05" }, TODAY_MS)).toEqual({
      from: "2025-08-31",
      to: "2026-09-05",
    });
    expect(addDays("2025-08-31", MAX_WINDOW_DAYS - 1)).toBe("2026-09-05");
  });

  it("takes an explicit window as-is and completes a lone from with today", () => {
    expect(resolveWindow({ from: "2026-08-01", to: "2026-08-23" }, TODAY_MS)).toEqual({
      from: "2026-08-01",
      to: "2026-08-23",
    });
    expect(resolveWindow({ from: "2026-08-01" }, TODAY_MS)).toEqual({
      from: "2026-08-01",
      to: "2026-09-02",
    });
    expect(resolveWindow({ from: "2026-09-02" }, TODAY_MS)).toEqual({
      from: "2026-09-02",
      to: "2026-09-02",
    });
  });

  it("rejects an inverted window — a from after the (possibly defaulted) to", () => {
    expect(resolveWindow({ from: "2026-08-23", to: "2026-08-22" }, TODAY_MS)).toBeNull();
    expect(resolveWindow({ from: "2026-09-03" }, TODAY_MS)).toBeNull();
  });

  it("caps the width at MAX_WINDOW_DAYS inclusive", () => {
    const from = "2025-01-05";
    const widest = addDays(from, MAX_WINDOW_DAYS - 1);
    expect(resolveWindow({ from, to: widest }, TODAY_MS)).toEqual({ from, to: widest });
    expect(resolveWindow({ from, to: addDays(widest, 1) }, TODAY_MS)).toBeNull();
  });

  it("rejects the last day of the 4-digit calendar (the exclusive bound needs to + 1)", () => {
    expect(resolveWindow({ from: "9999-12-01", to: "9999-12-31" }, TODAY_MS)).toBeNull();
    expect(resolveWindow({ from: "9999-12-01", to: "9999-12-30" }, TODAY_MS)).toEqual({
      from: "9999-12-01",
      to: "9999-12-30",
    });
  });
});

describe("buildHeatmap", () => {
  it("lays out dense zeros when nothing grew", () => {
    expect(buildHeatmap([], "2026-09-01", "2026-09-03")).toEqual([
      { day: "2026-09-01", count: 0, level: 0 },
      { day: "2026-09-02", count: 0, level: 0 },
      { day: "2026-09-03", count: 0, level: 0 },
    ]);
  });

  it("buckets instants into JST days, not UTC ones", () => {
    // 08:00 JST is still the previous day on the UTC calendar.
    const morning = jst(2026, 9, 2, 8, 0);
    expect(new Date(morning).toISOString()).toBe("2026-09-01T23:00:00.000Z");
    expect(buildHeatmap([morning], "2026-09-01", "2026-09-02")).toEqual([
      { day: "2026-09-01", count: 0, level: 0 },
      { day: "2026-09-02", count: 1, level: 1 },
    ]);
  });

  it("counts JST midnight as the opening of its day", () => {
    const midnight = jst(2026, 9, 2);
    expect(buildHeatmap([midnight, midnight - 1], "2026-09-01", "2026-09-02")).toEqual([
      { day: "2026-09-01", count: 1, level: 1 },
      { day: "2026-09-02", count: 1, level: 1 },
    ]);
  });

  it("darkens one step per 苔片 and saturates at level 4", () => {
    const at = (n: number) => Array.from({ length: n }, (_, i) => jst(2026, 9, 2, 10, 0, i));
    for (const [count, level] of [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 4],
      [12, 4],
    ] as const) {
      expect(buildHeatmap(at(count), "2026-09-02", "2026-09-02")).toEqual([
        { day: "2026-09-02", count, level },
      ]);
    }
  });
});

describe("timelineQuerySchema — the three forms and nothing between", () => {
  it("accepts each form alone", () => {
    expect(timelineQuerySchema.safeParse({}).success).toBe(true);
    expect(timelineQuerySchema.safeParse({ focus: "some-tag-id" }).success).toBe(true);
    expect(timelineQuerySchema.safeParse({ tags: "a,b" }).success).toBe(true);
  });

  it("rejects focus and tags together — a mixed request has no meaning", () => {
    expect(timelineQuerySchema.safeParse({ focus: "a", tags: "a,b" }).success).toBe(false);
  });

  it("rejects empty and absurdly long values before any parsing", () => {
    expect(timelineQuerySchema.safeParse({ focus: "" }).success).toBe(false);
    expect(timelineQuerySchema.safeParse({ focus: "x".repeat(65) }).success).toBe(false);
    expect(timelineQuerySchema.safeParse({ tags: "" }).success).toBe(false);
    expect(timelineQuerySchema.safeParse({ tags: "a,".repeat(700) + "b" }).success).toBe(false);
  });
});

describe("parseTagsParam", () => {
  it("keeps request order and trims around commas", () => {
    expect(parseTagsParam("b,a")).toEqual(["b", "a"]);
    expect(parseTagsParam(" b , a ")).toEqual(["b", "a"]);
  });

  it("needs a combination: fewer than 2 unique ids is not this form", () => {
    expect(parseTagsParam("a")).toBeNull();
    expect(parseTagsParam("a,a")).toBeNull();
    expect(parseTagsParam("a,a,b")).toEqual(["a", "b"]);
  });

  it("rejects empty segments and overlong ids", () => {
    expect(parseTagsParam("a,,b")).toBeNull();
    expect(parseTagsParam("a,b,")).toBeNull();
    expect(parseTagsParam(`a,${"x".repeat(65)}`)).toBeNull();
  });

  it("caps the set at TIMELINE_MAX_TAGS (= what one 苔片 can carry)", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`).join(",");
    expect(parseTagsParam(ids(TIMELINE_MAX_TAGS))).toHaveLength(TIMELINE_MAX_TAGS);
    expect(parseTagsParam(ids(TIMELINE_MAX_TAGS + 1))).toBeNull();
  });
});

describe("buildTagSpans", () => {
  const raw = (
    id: string,
    norm: string,
    first: number | null,
    last: number | null,
    count = 1,
  ) => ({ id, name: id.toUpperCase(), norm, first, last, count });

  it("folds instants into JST days — a JST morning stays on its JST day", () => {
    // 08:00 JST is still the previous day on the UTC calendar.
    const spans = buildTagSpans([raw("ts", "ts", jst(2026, 9, 2, 8, 0), jst(2026, 9, 3, 23, 59), 4)]);
    expect(spans).toEqual([
      { tag: { id: "ts", name: "TS" }, firstDay: "2026-09-02", lastDay: "2026-09-03", count: 4 },
    ]);
  });

  it("orders as a 年表: first day ascending, same-day ties by norm", () => {
    const spans = buildTagSpans([
      raw("b", "beta", jst(2026, 9, 2, 20), jst(2026, 9, 2, 20)),
      raw("c", "gamma", jst(2026, 9, 3), jst(2026, 9, 3)),
      // Later instant than "b" but the same JST day — norm decides, so the
      // order can't jitter with the time of day a stone was first used.
      raw("a", "alpha", jst(2026, 9, 2, 23), jst(2026, 9, 2, 23)),
    ]);
    expect(spans.map((s) => s.tag.id)).toEqual(["a", "b", "c"]);
  });

  it("skips a null aggregate row instead of crashing the whole 年表", () => {
    const spans = buildTagSpans([
      raw("dead", "dead", null, null, 0),
      raw("ok", "ok", jst(2026, 9, 2), jst(2026, 9, 2)),
    ]);
    expect(spans.map((s) => s.tag.id)).toEqual(["ok"]);
  });
});
