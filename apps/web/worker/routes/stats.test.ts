import { describe, expect, it } from "vitest";
import { addDays } from "../core/day";
import { app } from "../index";
import { testEnv } from "../test-support";
import {
  MAX_WINDOW_DAYS,
  buildGraph,
  buildHeatmap,
  buildTagSpans,
  graphQuerySchema,
  heatmapQuerySchema,
  monthCounts,
  monthCountsByTag,
  periodStartDay,
  resolveWindow,
  timelineQuerySchema,
  type RawGraphNode,
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

  it("GET /api/stats/graph without a session is 401 (not 404 — the route is mounted)", async () => {
    const res = await app.request("/api/stats/graph", {}, testEnv());
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

// parseTagsParam's tests live in core/tag.test.ts — the `?tags=` wire 規約
// moved to core when posts' filter started sharing it (2026-09-03).

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

describe("monthCounts — a row's 活動月: JST months, sparse and ascending", () => {
  it("files a JST morning on the 1st under the new month, not the UTC calendar's old one", () => {
    const morning = jst(2026, 9, 1, 8, 0);
    expect(new Date(morning).toISOString()).toBe("2026-08-31T23:00:00.000Z");
    expect(monthCounts([morning])).toEqual([{ month: "2026-09", count: 1 }]);
  });

  it("lists only months with a 苔片, oldest first, whatever order the rows came in", () => {
    expect(monthCounts([jst(2026, 3, 20), jst(2026, 1, 5), jst(2026, 3, 2)])).toEqual([
      { month: "2026-01", count: 1 },
      { month: "2026-03", count: 2 },
    ]);
  });

  it("is empty for no 苔片", () => {
    expect(monthCounts([])).toEqual([]);
  });
});

describe("monthCountsByTag — the same fold per stone", () => {
  it("groups the axis rows by tag, each list sparse and ascending", () => {
    const byTag = monthCountsByTag([
      { tagId: "ts", createdAt: jst(2026, 9, 2) },
      { tagId: "moss", createdAt: jst(2026, 9, 2) },
      { tagId: "ts", createdAt: jst(2026, 7, 1) },
    ]);
    expect(byTag.get("ts")).toEqual([
      { month: "2026-07", count: 1 },
      { month: "2026-09", count: 1 },
    ]);
    expect(byTag.get("moss")).toEqual([{ month: "2026-09", count: 1 }]);
    expect(byTag.has("ghost")).toBe(false);
  });
});

describe("graphQuerySchema — the three windows and nothing else", () => {
  it("accepts an empty query and each period", () => {
    expect(graphQuerySchema.safeParse({}).success).toBe(true);
    for (const period of ["month", "year", "all"]) {
      expect(graphQuerySchema.safeParse({ period }).success).toBe(true);
    }
  });

  it("rejects a window the route does not offer", () => {
    expect(graphQuerySchema.safeParse({ period: "week" }).success).toBe(false);
    expect(graphQuerySchema.safeParse({ period: "" }).success).toBe(false);
  });
});

describe("periodStartDay — 今月/今年 are cut in APP_TZ, like every other day", () => {
  it("names the first day of the running month and year", () => {
    expect(periodStartDay("month", TODAY_MS)).toBe("2026-09-01");
    expect(periodStartDay("year", TODAY_MS)).toBe("2026-01-01");
  });

  it("crosses the boundary on JST time, not UTC", () => {
    // 00:30 JST on Jan 1 is still Dec 31 in UTC — the new year has begun here.
    const newYear = jst(2027, 1, 1, 0, 30);
    expect(new Date(newYear).toISOString()).toBe("2026-12-31T15:30:00.000Z");
    expect(periodStartDay("year", newYear)).toBe("2027-01-01");
    expect(periodStartDay("month", newYear)).toBe("2027-01-01");
  });
});

describe("buildGraph", () => {
  const rawNode = (
    id: string,
    norm: string,
    count: number,
    color: string | null = null,
  ): RawGraphNode => ({ id, name: id.toUpperCase(), norm, color, count });

  it("orders stones 苔片数 desc with norm ties, and keeps norm off the wire", () => {
    const { nodes } = buildGraph(
      [rawNode("b", "beta", 2), rawNode("c", "gamma", 5, "#3d6b4f"), rawNode("a", "alpha", 2)],
      [],
    );
    expect(nodes.map((n) => n.id)).toEqual(["c", "a", "b"]);
    // The tag's own color rides along for the stone; nothing else is added.
    expect(nodes[0]).toEqual({ id: "c", name: "C", color: "#3d6b4f", count: 5 });
  });

  it("orders bridges by co-occurrence desc, ties by pair", () => {
    const nodes = [rawNode("a", "a", 9), rawNode("b", "b", 9), rawNode("c", "c", 9)];
    const { edges } = buildGraph(nodes, [
      { a: "a", b: "c", count: 1 },
      { a: "b", b: "c", count: 4 },
      { a: "a", b: "b", count: 1 },
    ]);
    expect(edges).toEqual([
      { a: "b", b: "c", count: 4 },
      { a: "a", b: "b", count: 1 },
      { a: "a", b: "c", count: 1 },
    ]);
  });

  it("drops a bridge to a missing stone instead of crashing the map", () => {
    const { edges } = buildGraph([rawNode("a", "a", 1)], [{ a: "a", b: "ghost", count: 1 }]);
    expect(edges).toEqual([]);
  });
});
