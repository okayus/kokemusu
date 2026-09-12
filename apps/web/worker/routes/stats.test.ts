import { describe, expect, it } from "vitest";
import { addDays } from "../core/day";
import type { PostKind } from "../core/kind";
import { app } from "../index";
import { testEnv } from "../test-support";
import {
  MAX_WINDOW_DAYS,
  buildFocusRows,
  buildGraph,
  buildHeatmap,
  heatmapTotals,
  buildTagSpans,
  graphQuerySchema,
  heatmapQuerySchema,
  periodStartDay,
  resolveWindow,
  rowAmounts,
  rowAmountsByTag,
  timelineQuerySchema,
  type GraphEdgeRow,
  type GraphNodeRow,
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
  const on = (firstDay: string, lastDay = firstDay, kind: PostKind | null = null) => ({
    firstDay,
    lastDay,
    kind,
  });
  const cell = (day: string, count: number, input = 0, output = 0) => ({
    day,
    count,
    level: Math.min(count, 4),
    input,
    output,
  });

  it("lays out dense zeros when nothing grew", () => {
    expect(buildHeatmap([], "2026-09-01", "2026-09-03")).toEqual([
      cell("2026-09-01", 0),
      cell("2026-09-02", 0),
      cell("2026-09-03", 0),
    ]);
  });

  it("lights the days the 苔片 were there — a 続く苔片 on each of its days, once (ADR-0005)", () => {
    expect(
      buildHeatmap([on("2026-09-02"), on("2026-09-03", "2026-09-05")], "2026-09-01", "2026-09-06"),
    ).toEqual([
      cell("2026-09-01", 0),
      cell("2026-09-02", 1),
      cell("2026-09-03", 1),
      cell("2026-09-04", 1),
      cell("2026-09-05", 1),
      cell("2026-09-06", 0),
    ]);
  });

  it("clips a span to the window — the moss shows only the days it can see", () => {
    expect(buildHeatmap([on("2026-08-20", "2026-09-10")], "2026-09-01", "2026-09-02")).toEqual([
      cell("2026-09-01", 1),
      cell("2026-09-02", 1),
    ]);
  });

  it("darkens one step per 苔片 and saturates at level 4", () => {
    const at = (n: number) => Array.from({ length: n }, () => on("2026-09-02"));
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
        { day: "2026-09-02", count, level, input: 0, output: 0 },
      ]);
    }
  });

  it("carries each day's 入 / 出 — `both` on both sides, 未分類 on neither — and a 続く苔片 faces its way on every day", () => {
    const day = "2026-09-02";
    const spans = [
      on(day, day, "input"),
      on(day, day, "output"),
      on(day, day, "both"),
      on(day),
      on("2026-09-01", "2026-09-03", "input"),
    ];
    expect(buildHeatmap(spans, "2026-09-01", "2026-09-03")).toEqual([
      cell("2026-09-01", 1, 1),
      cell(day, 5, 3, 2),
      cell("2026-09-03", 1, 1),
    ]);
  });
});

describe("heatmapTotals — the window's 苔片 by 向き, per 苔片 like `total`", () => {
  const span = (kind: PostKind | null, firstDay = "2026-09-02", lastDay = firstDay) => ({
    firstDay,
    lastDay,
    kind,
  });

  it("is all zeros for an empty window", () => {
    expect(heatmapTotals([])).toEqual({ total: 0, input: 0, output: 0 });
  });

  it("counts `both` on both sides and 未分類 only in the total", () => {
    expect(heatmapTotals([span("input"), span("output"), span("both"), span(null)])).toEqual({
      total: 4,
      input: 2,
      output: 2,
    });
  });

  it("counts a 続く苔片 once however many days it lights", () => {
    expect(heatmapTotals([span("input", "2026-08-01", "2026-09-30")])).toEqual({
      total: 1,
      input: 1,
      output: 0,
    });
  });
});

describe("timelineQuerySchema — the three forms and nothing between", () => {
  it("accepts each form alone — focus as one id or a list (選んだ石)", () => {
    expect(timelineQuerySchema.safeParse({}).success).toBe(true);
    expect(timelineQuerySchema.safeParse({ focus: "some-tag-id" }).success).toBe(true);
    expect(timelineQuerySchema.safeParse({ focus: "a,b" }).success).toBe(true);
    expect(timelineQuerySchema.safeParse({ tags: "a,b" }).success).toBe(true);
  });

  it("rejects focus and tags together — a mixed request has no meaning", () => {
    expect(timelineQuerySchema.safeParse({ focus: "a", tags: "a,b" }).success).toBe(false);
  });

  it("rejects empty and absurdly long values before any parsing", () => {
    expect(timelineQuerySchema.safeParse({ focus: "" }).success).toBe(false);
    expect(timelineQuerySchema.safeParse({ focus: "a,".repeat(700) + "b" }).success).toBe(false);
    expect(timelineQuerySchema.safeParse({ tags: "" }).success).toBe(false);
    expect(timelineQuerySchema.safeParse({ tags: "a,".repeat(700) + "b" }).success).toBe(false);
  });

  it("leaves the shape of the ids to core — an overlong id passes the gate and fails the parser", () => {
    // Same split as ?tags=: the schema caps the whole string, parseFocusParam
    // (core/tag.test.ts) rejects the segment, and the route answers 400 either way.
    expect(timelineQuerySchema.safeParse({ focus: "x".repeat(65) }).success).toBe(true);
  });
});

// parseTagsParam's and parseFocusParam's tests live in core/tag.test.ts — the
// `?tags=` wire 規約 moved to core when posts' filter started sharing it
// (2026-09-03), and `?focus=` took the same list on 2026-09-07.

describe("buildFocusRows — 選んだ石 as one row, then set × each co-occurring stone", () => {
  const raw = (id: string, first: string, last: string, count: number) => ({
    id,
    name: id.toUpperCase(),
    norm: id,
    first,
    last,
    count,
  });
  const named = (...ids: string[]) => ids.map((id) => ({ id, name: id.toUpperCase() }));
  const on = (firstDay: string, lastDay = firstDay, thickness: number | null = null) => ({
    firstDay,
    lastDay,
    thickness,
  });
  const link = (tagId: string, firstDay: string, lastDay = firstDay, thickness: number | null = null) => ({
    tagId,
    ...on(firstDay, lastDay, thickness),
  });

  it("draws the #30 one-stone form: the stone, then stone × co-occurring stones in 年表 order", () => {
    const rows = buildFocusRows({
      ids: ["ts"],
      agg: { first: "2026-09-01", last: "2026-09-05", count: 3 },
      named: named("ts"),
      setAxis: [on("2026-09-01"), on("2026-09-03"), on("2026-09-05")],
      // Handed back in whatever order SQLite grouped them; the fold sorts.
      cooc: [raw("hono", "2026-09-05", "2026-09-05", 1), raw("d1", "2026-09-03", "2026-09-05", 2)],
      coocAxis: [link("d1", "2026-09-03"), link("d1", "2026-09-05"), link("hono", "2026-09-05")],
    });
    expect(rows).toEqual([
      {
        tags: [{ id: "ts", name: "TS" }],
        firstDay: "2026-09-01",
        lastDay: "2026-09-05",
        count: 3,
        amount: 3,
        months: [{ month: "2026-09", amount: 3 }],
      },
      {
        tags: [
          { id: "ts", name: "TS" },
          { id: "d1", name: "D1" },
        ],
        firstDay: "2026-09-03",
        lastDay: "2026-09-05",
        count: 2,
        amount: 2,
        months: [{ month: "2026-09", amount: 2 }],
      },
      {
        tags: [
          { id: "ts", name: "TS" },
          { id: "hono", name: "HONO" },
        ],
        firstDay: "2026-09-05",
        lastDay: "2026-09-05",
        count: 1,
        amount: 1,
        months: [{ month: "2026-09", amount: 1 }],
      },
    ]);
  });

  it("keeps the set in request order on every row, whatever order the names came back", () => {
    const rows = buildFocusRows({
      ids: ["vue", "案件"],
      agg: { first: "2026-01-10", last: "2026-03-20", count: 1 },
      named: named("案件", "vue"),
      setAxis: [on("2026-01-10", "2026-03-20", 100)],
      cooc: [raw("hono", "2026-02-01", "2026-02-28", 1)],
      coocAxis: [link("hono", "2026-02-01", "2026-02-28", 50)],
    });
    expect(rows.map((r) => r.tags.map((t) => t.id))).toEqual([
      ["vue", "案件"],
      ["vue", "案件", "hono"],
    ]);
    // One 続く苔片 across three months at 100%: 22 + 28 + 20 days — the row's
    // count stays 1, its 量 is the 70 days, and the months add up to it (ADR-0007).
    expect([rows[0]?.count, rows[0]?.amount]).toEqual([1, 70]);
    expect(rows[0]?.months).toEqual([
      { month: "2026-01", amount: 22 },
      { month: "2026-02", amount: 28 },
      { month: "2026-03", amount: 20 },
    ]);
    // February at 50%: 28 × 0.5.
    expect([rows[1]?.count, rows[1]?.amount, rows[1]?.months]).toEqual([
      1,
      14,
      [{ month: "2026-02", amount: 14 }],
    ]);
  });

  it("is just the set row when nothing else grows on those 苔片", () => {
    const rows = buildFocusRows({
      ids: ["a", "b"],
      agg: { first: "2026-09-02", last: "2026-09-02", count: 1 },
      named: named("a", "b"),
      setAxis: [on("2026-09-02")],
      cooc: [],
      coocAxis: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tags.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("is empty, not an error, when no 苔片 carries the whole set or an id names no stone", () => {
    const base = {
      named: named("a", "b"),
      setAxis: [],
      cooc: [],
      coocAxis: [],
    };
    // COUNT over no rows — SQLite still returns one aggregate row, all null but the 0.
    expect(buildFocusRows({ ids: ["a", "b"], agg: { first: null, last: null, count: 0 }, ...base })).toEqual([]);
    expect(buildFocusRows({ ids: ["a", "b"], agg: undefined, ...base })).toEqual([]);
    // A foreign or dead id: nothing can carry it, and its name is not the user's to echo.
    expect(
      buildFocusRows({
        ids: ["a", "ghost"],
        agg: { first: "2026-09-02", last: "2026-09-02", count: 1 },
        ...base,
      }),
    ).toEqual([]);
  });

  it("throws on a row the CHECKs would have refused — a broken store is not drawn", () => {
    expect(() =>
      buildFocusRows({
        ids: ["a"],
        agg: { first: "2026-09-01", last: "2026-09-02", count: 1 },
        named: named("a"),
        setAxis: [on("2026-09-01", "2026-09-02", null)],
        cooc: [],
        coocAxis: [],
      }),
    ).toThrow(RangeError);
  });
});

describe("buildTagSpans", () => {
  const raw = (id: string, norm: string, first: string | null, last: string | null, count = 1) => ({
    id,
    name: id.toUpperCase(),
    norm,
    first,
    last,
    count,
  });

  it("takes the aggregate's days as they are — MIN(first_day) / MAX(last_day) are already 「日」", () => {
    const spans = buildTagSpans([raw("ts", "ts", "2026-09-02", "2026-09-03", 4)]);
    expect(spans).toEqual([
      { tag: { id: "ts", name: "TS" }, firstDay: "2026-09-02", lastDay: "2026-09-03", count: 4 },
    ]);
  });

  it("orders as a 年表: first day ascending, same-day ties by norm", () => {
    const spans = buildTagSpans([
      raw("b", "beta", "2026-09-02", "2026-09-02"),
      raw("c", "gamma", "2026-09-03", "2026-09-03"),
      // Same first day as "b" — norm decides, so the order can't jitter with
      // which stone happened to be written first that day.
      raw("a", "alpha", "2026-09-02", "2026-09-05"),
    ]);
    expect(spans.map((s) => s.tag.id)).toEqual(["a", "b", "c"]);
  });

  it("skips a null aggregate row instead of crashing the whole 年表", () => {
    const spans = buildTagSpans([
      raw("dead", "dead", null, null, 0),
      raw("ok", "ok", "2026-09-02", "2026-09-02"),
    ]);
    expect(spans.map((s) => s.tag.id)).toEqual(["ok"]);
  });
});

describe("rowAmounts — a row's 量 and its 活動月 by 量, sparse and ascending", () => {
  const on = (firstDay: string, lastDay = firstDay, thickness: number | null = null) => ({
    firstDay,
    lastDay,
    thickness,
  });

  it("lists only months with a 苔片, oldest first, whatever order the rows came in — single days are 1 each", () => {
    expect(rowAmounts([on("2026-03-20"), on("2026-01-05"), on("2026-03-02")])).toEqual({
      amount: 3,
      months: [
        { month: "2026-01", amount: 1 },
        { month: "2026-03", amount: 2 },
      ],
    });
  });

  it("gives a 続く苔片 each month its days × 厚み — the months add up to the row's 量 (ADR-0007)", () => {
    // Aug 30–31, September, Oct 1–2 at 50%: 2 + 30 + 2 days.
    expect(rowAmounts([on("2026-08-30", "2026-10-02", 50)])).toEqual({
      amount: 17,
      months: [
        { month: "2026-08", amount: 1 },
        { month: "2026-09", amount: 15 },
        { month: "2026-10", amount: 1 },
      ],
    });
  });

  it("stacks single days and 続く苔片 alike, and keeps the count out of it — 3 苔片 can weigh 1.2", () => {
    const { amount, months } = rowAmounts([on("2026-09-02"), on("2026-09-01", "2026-09-10", 1), on("2026-09-02")]);
    expect(amount).toBeCloseTo(2.1, 12);
    expect(months).toHaveLength(1);
    expect(months[0]?.month).toBe("2026-09");
    expect(months[0]?.amount).toBeCloseTo(2.1, 12);
  });

  it("is 0 and empty for no 苔片", () => {
    expect(rowAmounts([])).toEqual({ amount: 0, months: [] });
  });

  it("throws on a row the CHECKs would have refused", () => {
    expect(() => rowAmounts([on("2026-09-02", "2026-09-02", 60)])).toThrow(RangeError);
    expect(() => rowAmounts([on("2026-09-05", "2026-09-02", 60)])).toThrow(RangeError);
  });
});

describe("rowAmountsByTag — the same fold per stone", () => {
  it("groups the axis rows by tag, each 量 and months its own", () => {
    const byTag = rowAmountsByTag([
      { tagId: "ts", firstDay: "2026-09-02", lastDay: "2026-09-02", thickness: null },
      { tagId: "moss", firstDay: "2026-09-02", lastDay: "2026-09-02", thickness: null },
      { tagId: "ts", firstDay: "2026-07-01", lastDay: "2026-07-10", thickness: 60 },
    ]);
    expect(byTag.get("ts")).toEqual({
      amount: 7,
      months: [
        { month: "2026-07", amount: 6 },
        { month: "2026-09", amount: 1 },
      ],
    });
    expect(byTag.get("moss")).toEqual({ amount: 1, months: [{ month: "2026-09", amount: 1 }] });
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

describe("buildGraph — stones and bridges by 量, clipped to the period", () => {
  const stone = (
    id: string,
    firstDay: string,
    lastDay = firstDay,
    thickness: number | null = null,
    norm = id,
    color: string | null = null,
  ): GraphNodeRow => ({ id, name: id.toUpperCase(), norm, color, firstDay, lastDay, thickness });
  const bridge = (
    a: string,
    b: string,
    firstDay: string,
    lastDay = firstDay,
    thickness: number | null = null,
  ): GraphEdgeRow => ({ a, b, firstDay, lastDay, thickness });

  it("sums each stone's 苔片 — a single day 1, a 続く苔片 its days × 厚み — and orders 量 desc with norm ties, norm kept off the wire", () => {
    const { nodes } = buildGraph(
      [
        stone("b", "2026-09-01", "2026-09-01", null, "beta"),
        stone("b", "2026-09-02", "2026-09-02", null, "beta"),
        stone("c", "2026-08-28", "2026-09-06", 50, "gamma", "#3d6b4f"),
        stone("a", "2026-09-01", "2026-09-01", null, "alpha"),
        stone("a", "2026-09-03", "2026-09-03", null, "alpha"),
      ],
      [],
    );
    expect(nodes.map((n) => [n.id, n.amount])).toEqual([
      ["c", 5],
      ["a", 2],
      ["b", 2],
    ]);
    // The tag's own color rides along for the stone; nothing else is added.
    expect(nodes[0]).toEqual({ id: "c", name: "C", color: "#3d6b4f", amount: 5 });
  });

  it("clips every 苔片 to the window — 今月 sees only this month's days of a 案件 running since last year", () => {
    const rows = [
      stone("案件", "2025-11-01", "2026-09-02", 60),
      stone("案件", "2026-09-02"),
      stone("memo", "2026-08-31"),
    ];
    const all = buildGraph(rows, []);
    expect(all.nodes.map((n) => [n.id, n.amount])).toEqual([
      ["案件", 306 * 0.6 + 1],
      ["memo", 1],
    ]);
    const month = buildGraph(rows, [], { from: "2026-09-01", to: "2026-09-02" });
    // 2 days × 0.6 + the single day; the August memo weighs nothing here (the
    // SQL would not even hand it over — `last_day >= 初日`).
    expect(month.nodes.map((n) => [n.id, n.amount])).toEqual([
      ["案件", 2.2],
      ["memo", 0],
    ]);
  });

  it("sums a bridge over the 苔片 carrying both, clipped the same way, ordered 量 desc then by pair", () => {
    const nodes = [stone("a", "2026-09-01"), stone("b", "2026-09-01"), stone("c", "2026-09-01")];
    const { edges } = buildGraph(nodes, [
      bridge("a", "c", "2026-09-01"),
      bridge("b", "c", "2026-08-30", "2026-09-02", 100),
      bridge("b", "c", "2026-09-01"),
      bridge("a", "b", "2026-09-01"),
    ]);
    expect(edges).toEqual([
      { a: "b", b: "c", amount: 5 },
      { a: "a", b: "b", amount: 1 },
      { a: "a", b: "c", amount: 1 },
    ]);
    const month = buildGraph(nodes, [bridge("b", "c", "2026-08-30", "2026-09-02", 100)], {
      from: "2026-09-01",
      to: "2026-09-02",
    });
    expect(month.edges).toEqual([{ a: "b", b: "c", amount: 2 }]);
  });

  it("drops a bridge to a missing stone instead of crashing the map", () => {
    const { edges } = buildGraph([stone("a", "2026-09-01")], [bridge("a", "ghost", "2026-09-01")]);
    expect(edges).toEqual([]);
  });

  it("throws on a row the CHECKs would have refused — a broken store is not drawn", () => {
    expect(() => buildGraph([stone("a", "2026-09-01", "2026-09-01", 60)], [])).toThrow(RangeError);
    expect(() => buildGraph([], [bridge("a", "b", "2026-09-01", "2026-09-05", null)])).toThrow(RangeError);
  });

  it("is empty for an empty period", () => {
    expect(buildGraph([], [])).toEqual({ nodes: [], edges: [] });
  });
});
