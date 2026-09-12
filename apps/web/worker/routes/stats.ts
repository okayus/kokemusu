import {
  and,
  count,
  countDistinct,
  eq,
  gte,
  inArray,
  lt,
  lte,
  max,
  min,
  notInArray,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { z } from "zod";
import {
  addDays,
  bucketSpansByDay,
  dayKey,
  dayOfWeek,
  enumerateDays,
  isDayKey,
  type DayKey,
  type DaySpan,
  type MonthKey,
} from "../core/day";
import { isInput, isOutput, type PostKind } from "../core/kind";
import {
  amountByMonth,
  amountOf,
  decodeStacking,
  totalAmount,
  type DayWindow,
  type StackingRow,
} from "../core/stacking";
import { parseFocusParam, parseTagsParam } from "../core/tag";
import { createDb } from "../db";
import { post, postTags, tag } from "../db/schema";
import { fail } from "../lib/errors";
import type { Env } from "../types";

/** Widest window the route serves: 53 Sunday-start columns, GitHub-style. */
export const MAX_WINDOW_DAYS = 53 * 7;

// The shading scale is FIXED — level = min(count, 4) — not relative to the
// window's max. The same darkness then means the same number of 苔片 on every
// garden and in every window, so tags can be compared side by side, and a past
// cell never changes colour because other days grew. It also makes DoD 4
// mechanical: each of the first four 苔片 of a day darkens today's cell by
// exactly one step. A 5th+ 苔片 saturates — びっしり is びっしり.
const MAX_LEVEL = 4;

// Exported for direct unit tests (the D1-free harness cannot get past
// sessionMiddleware, same arrangement as routes/posts.ts). No ?tag= on
// purpose: the heatmap is the 総草 and never splits by tag (visualization.md
// §1, 2026-09-02) — per-tag devotion is the graph's and the tag timeline's job.
export const heatmapQuerySchema = z.object({
  from: z.string().refine(isDayKey, "must be a YYYY-MM-DD calendar day").optional(),
  to: z.string().refine(isDayKey, "must be a YYYY-MM-DD calendar day").optional(),
});

/**
 * Resolve `?from=`/`?to=` into the inclusive day window the series covers.
 * Defaults: `to` = today (APP_TZ), `from` = the Sunday opening `to`'s week,
 * 52 weeks earlier — 53 columns whose last one is the running week, exactly
 * the GitHub-style garden. Returns null on a window the route answers 400 to:
 * inverted, wider than MAX_WINDOW_DAYS, or ending on the last day of the
 * 4-digit calendar — a rule from when the window was cut in instants and needed
 * `to + 1`; nothing needs it since ADR-0005, but the wire has said 400 there
 * since #37 and A1 changes no behaviour.
 */
export function resolveWindow(
  query: { from?: string | undefined; to?: string | undefined },
  todayMs: number,
): { from: DayKey; to: DayKey } | null {
  const to = query.to ?? dayKey(todayMs);
  const from = query.from ?? addDays(to, -(dayOfWeek(to) + (MAX_WINDOW_DAYS - 7)));
  if (to < from) return null;
  // Width is checked by stepping BACK from `to`: day keys compare
  // chronologically while both years have 4 digits, and walking backwards
  // from a valid key never leaves them (forwards from `from` could cross
  // into year 10000 and break the comparison).
  if (from < addDays(to, -(MAX_WINDOW_DAYS - 1))) return null;
  if (to === "9999-12-31") return null;
  return { from, to };
}

/**
 * One cell on the wire: the day, its 苔片 count, the 0..4 shade, and the two
 * sides of 向き that were there (core/kind.ts: `both` counts on each) — the
 * client compares them for the cell's hue and reads them out with the count.
 */
export type HeatmapDay = {
  day: DayKey;
  count: number;
  level: number;
  input: number;
  output: number;
};

/** What the heatmap SQL hands back per 苔片 overlapping the window: its days and its 向き. */
export type HeatmapSpan = DaySpan & { kind: PostKind | null };

/**
 * Fold the 苔片 spans into the dense ascending series the SVG draws — a 続く苔片
 * lights each of its days inside the window (ADR-0005), and each day carries
 * its 入 / 出 tallies from core, so the hue is decided where the count is.
 */
export function buildHeatmap(spans: Iterable<HeatmapSpan>, from: DayKey, to: DayKey): HeatmapDay[] {
  const tallies = bucketSpansByDay(spans, from, to);
  return enumerateDays(from, to).map((day) => {
    const { count, input, output } = tallies.get(day) ?? { count: 0, input: 0, output: 0 };
    return { day, count, level: Math.min(count, MAX_LEVEL), input, output };
  });
}

/** The window's totals on the wire: 苔片 overlapping it, and how many face each way. */
export type HeatmapTotals = { total: number; input: number; output: number };

/**
 * Count the 苔片 of the window by their 向き — per 苔片, not per day, so a
 * 続く苔片 is one on each side it faces however many cells it lights (the same
 * rule as `total`, visualization.md §1). The caption's 「吸う x% · 出す y%」 is
 * these over `total`; `both` is on both sides, so the two need not add to 100.
 */
export function heatmapTotals(spans: Iterable<HeatmapSpan>): HeatmapTotals {
  let total = 0;
  let input = 0;
  let output = 0;
  for (const span of spans) {
    total += 1;
    if (isInput(span.kind)) input += 1;
    if (isOutput(span.kind)) output += 1;
  }
  return { total, input, output };
}

// ---------------------------------------------------------------------------
// タグのタイムライン (visualization.md §8): rows of "first 苔片 → last 苔片" per
// tag set. Like the heatmap, this whole route reads plaintext metadata only —
// `first_day` / `last_day` and `post_tags` — so BODY_KEY never enters the path
// (ADR-0001) and the 年表 draws even while the key is missing. The axis is the
// 「日」 range itself (ADR-0005): SQL takes MIN(first_day) / MAX(last_day) / COUNT
// for the span — day keys order as strings, no zone in the read — and hands
// each 苔片's two days and 厚み over for the 量 (ADR-0007), which core sums
// for the row and per month for the segments (`rowAmounts`).

// The three forms: no param = one row per tag, `?focus=` = the chosen stones —
// 選んだ石, one id since #30 and a comma list since 2026-09-07
// (docs/plans/tabs-and-stones.md) — as one row + set×co-occurring-stone rows,
// `?tags=` = one AND row (core/tag.ts の `?tags=` wire 規約 — posts の絞り込みと
// 共有). Both lists are parsed in core after the size gate here. focus and tags
// are exclusive — a request mixing them has no meaning.
export const timelineQuerySchema = z
  .object({
    focus: z.string().min(1).max(1400).optional(),
    tags: z.string().min(1).max(1400).optional(),
  })
  .refine((q) => q.focus === undefined || q.tags === undefined, "focus and tags are exclusive");

/** A stone on the wire — same shape the posts API uses for tags. */
export type TimelineTag = { id: string; name: string };

/**
 * 量 per 活動月 on the wire: the JST `YYYY-MM` and the 量 of the row's 苔片 in
 * it (ADR-0007: a single day 1, a 続く苔片 that month's days × its 厚み). Sparse
 * — only months holding a 苔片 — and ascending; the amounts add up to the
 * row's `amount`.
 */
export type MonthAmount = { month: MonthKey; amount: number };

/**
 * One row of the 年表: the tag set, its first/last day (JST), the 苔片 count
 * (枚数 — 「N 片」 stays an honest count), their 量, and its 活動月 (the month
 * segments, by 量).
 */
export type TimelineRow = {
  tags: TimelineTag[];
  firstDay: DayKey;
  lastDay: DayKey;
  count: number;
  amount: number;
  months: MonthAmount[];
};

/** What the grouped SQL hands back per tag; `norm` rides along as the tiebreaker. */
export type RawTagSpan = {
  id: string;
  name: string;
  norm: string;
  first: DayKey | null;
  last: DayKey | null;
  count: number;
};

/** A per-tag span: the first and last 「日」 straight from the aggregate. */
export type TagSpan = { tag: TimelineTag; firstDay: DayKey; lastDay: DayKey; count: number };

/**
 * Fold grouped rows into spans ordered as a 年表: by first day ascending, ties
 * by norm so the order is stable day-in day-out. Null aggregates cannot happen
 * for a grouped row (each group holds ≥ 1 post) — skipped defensively rather
 * than crashing the whole chart.
 */
export function buildTagSpans(raws: RawTagSpan[]): TagSpan[] {
  const spans: (TagSpan & { norm: string })[] = [];
  for (const r of raws) {
    if (r.first === null || r.last === null) continue;
    spans.push({
      tag: { id: r.id, name: r.name },
      norm: r.norm,
      firstDay: r.first,
      lastDay: r.last,
      count: r.count,
    });
  }
  spans.sort((a, b) =>
    a.firstDay < b.firstDay
      ? -1
      : a.firstDay > b.firstDay
        ? 1
        : a.norm < b.norm
          ? -1
          : a.norm > b.norm
            ? 1
            : 0,
  );
  return spans.map(({ norm: _norm, ...span }) => span);
}

/** The 量 side of a row: its 苔片's 量 summed, and per 活動月. */
export type RowAmounts = { amount: number; months: MonthAmount[] };

/** No 苔片 at all — a row the axis has nothing for (cannot happen: same batch, same snapshot). */
const NO_AMOUNTS: RowAmounts = { amount: 0, months: [] };

/**
 * Fold a row's 苔片 into its 量 (ADR-0007): the sum — no window, a row's own
 * MIN/MAX is its whole period — and the 活動月 with their 量, sparse and
 * ascending, so the client paints exactly these and nothing in between
 * (visualization.md §8: a single bar shows a gap as if it were one stretch).
 * A 続く苔片 is in every month it touches with that month's days × its 厚み, so
 * the months add up to `amount`. The rows are decoded here: one the CHECKs
 * would have refused throws (core/stacking.ts decodeStacking) rather than
 * drawing a 苔片 as something it is not.
 */
export function rowAmounts(rows: Iterable<StackingRow>): RowAmounts {
  const stackings = Array.from(rows, (r) => decodeStacking(r));
  const months = [...amountByMonth(stackings)]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([month, amount]) => ({ month, amount }));
  return { amount: totalAmount(stackings), months };
}

/** What the raw axis SQL hands back: one row per (苔片, tag) link, with the 苔片's days and 厚み. */
export type AxisRow = StackingRow & { tagId: string };

/** `rowAmounts` per tag — for the forms whose rows are one per tag. */
export function rowAmountsByTag(rows: Iterable<AxisRow>): Map<string, RowAmounts> {
  const byTag = new Map<string, StackingRow[]>();
  for (const r of rows) {
    const row = { firstDay: r.firstDay, lastDay: r.lastDay, thickness: r.thickness };
    const list = byTag.get(r.tagId);
    if (list === undefined) byTag.set(r.tagId, [row]);
    else list.push(row);
  }
  return new Map([...byTag].map(([tagId, list]) => [tagId, rowAmounts(list)]));
}

/** What the focus form's batch hands back, in the order its statements were sent. */
export type FocusMaterials = {
  /** The chosen stones' ids in request order — the rows' chip order. */
  ids: string[];
  /** MIN / MAX / COUNT over the 苔片 carrying the whole set (undefined = no aggregate row at all). */
  agg: { first: DayKey | null; last: DayKey | null; count: number } | undefined;
  /** The set's stones as the user's own tags — a missing id means no such stone. */
  named: TimelineTag[];
  /** The set's 苔片, their days and 厚み — the set row's 量 and 活動月. */
  setAxis: StackingRow[];
  /** Every OTHER stone on those 苔片, grouped — the set×stone rows. */
  cooc: RawTagSpan[];
  /** Those other stones' links with the 苔片's days and 厚み — the set×stone rows' 量 and 活動月. */
  coocAxis: AxisRow[];
};

/**
 * Fold the focus form's batch into its rows: the set itself first, then set ×
 * each co-occurring stone in 年表 order (`buildTagSpans`), every row's chips
 * starting with the set in request order. Empty when no 苔片 carries the whole
 * set — an unknown id lands here too, since nothing can carry it — the same
 * "empty, not an error" as the other forms.
 */
export function buildFocusRows(m: FocusMaterials): TimelineRow[] {
  const { agg } = m;
  if (agg === undefined || agg.count === 0 || agg.first === null || agg.last === null) return [];
  const byId = new Map(m.named.map((t) => [t.id, t] as const));
  const set = m.ids.flatMap((id) => {
    const hit = byId.get(id);
    return hit ? [hit] : [];
  });
  if (set.length !== m.ids.length) return [];
  const setAmounts = rowAmounts(m.setAxis);
  const byTag = rowAmountsByTag(m.coocAxis);
  return [
    {
      tags: set,
      firstDay: agg.first,
      lastDay: agg.last,
      count: agg.count,
      amount: setAmounts.amount,
      months: setAmounts.months,
    },
    ...buildTagSpans(m.cooc).map((s) => {
      const amounts = byTag.get(s.tag.id) ?? NO_AMOUNTS;
      return {
        tags: [...set, s.tag],
        firstDay: s.firstDay,
        lastDay: s.lastDay,
        count: s.count,
        amount: amounts.amount,
        months: amounts.months,
      };
    }),
  ];
}

// ---------------------------------------------------------------------------
// タグ関係グラフ (visualization.md §6): stones and the moss bridging them.
// Node = tag, its 量 = that of the 苔片 carrying it in the period (the stone's
// size — §6's replacement for a per-tag heatmap); edge = two tags on the same
// 苔片, its 量 = that of the 苔片 carrying both. 量, not count, since ADR-0007:
// a 続く苔片 grows its stones by its days × 厚み, and 今月 / 今年 take only the
// days inside the period (SQL hands the days and 厚み over, core clips and
// sums). Same plaintext-metadata-only diet as the rest of this file:
// `post_tags` and the day columns, never a body (ADR-0001).

/** 今月 / 今年 / 全期間 — the three windows §6 offers. Absent = 全期間. */
export const graphQuerySchema = z.object({
  period: z.enum(["month", "year", "all"]).optional(),
});

/**
 * First day of the running month/year — in APP_TZ, because the server decides
 * "today" for every stats view (same rule as the timeline's `today`), and a
 * period boundary cut in the client's zone would move the map by travel.
 */
export function periodStartDay(period: "month" | "year", todayMs: number): DayKey {
  const today = dayKey(todayMs);
  return period === "month" ? `${today.slice(0, 7)}-01` : `${today.slice(0, 4)}-01-01`;
}

/** A stone on the wire: display bits + the 量 of the 苔片 that grew on it in the period (a fraction, rounded only for display). */
export type GraphNode = { id: string; name: string; color: string | null; amount: number };

/** A bridge on the wire: the two stones' ids (`a` < `b`, one row per pair) + the 量 of the 苔片 they share. */
export type GraphEdge = { a: string; b: string; amount: number };

/**
 * What the node SQL hands back: one row per (苔片, stone) link in the period —
 * the stone's display bits (`norm` rides along as the tiebreaker) and the
 * 苔片's days and 厚み.
 */
export type GraphNodeRow = StackingRow & { id: string; name: string; norm: string; color: string | null };

/** What the edge SQL hands back: one row per (苔片, pair) in the period, `a` < `b`. */
export type GraphEdgeRow = StackingRow & { a: string; b: string };

/**
 * Fold the link rows into the map and order it for the wire. A stone's 量 is
 * the sum over the 苔片 carrying it, a bridge's over the 苔片 carrying both,
 * each 苔片 clipped to the period's `window` (none for 全期間) — so a 案件
 * running since last year weighs in 今年 with this year's days only, and a
 * 苔片 with several stones feeds each of them whole. Nodes come 量 descending
 * (ties by norm, so the order is stable day-in day-out), edges 量 descending
 * (ties by pair). An edge whose end is not among the nodes cannot happen —
 * both queries walk the same posts — but is dropped rather than crashing the
 * chart, mirroring buildTagSpans' defensiveness; a row the CHECKs would have
 * refused throws (decodeStacking), like the 年表's.
 */
export function buildGraph(
  nodeRows: Iterable<GraphNodeRow>,
  edgeRows: Iterable<GraphEdgeRow>,
  window?: DayWindow,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const stones = new Map<string, GraphNode & { norm: string }>();
  for (const r of nodeRows) {
    const amount = amountOf(decodeStacking(r), window);
    const stone = stones.get(r.id);
    if (stone === undefined) {
      stones.set(r.id, { id: r.id, name: r.name, color: r.color, amount, norm: r.norm });
    } else {
      stone.amount += amount;
    }
  }
  const bridges = new Map<string, GraphEdge>();
  for (const r of edgeRows) {
    const amount = amountOf(decodeStacking(r), window);
    const key = JSON.stringify([r.a, r.b]);
    const bridge = bridges.get(key);
    if (bridge === undefined) bridges.set(key, { a: r.a, b: r.b, amount });
    else bridge.amount += amount;
  }
  const byNorm = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  const nodes = [...stones.values()]
    .sort((x, y) => y.amount - x.amount || byNorm(x.norm, y.norm))
    .map(({ norm: _norm, ...node }) => node);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = [...bridges.values()]
    .filter((e) => ids.has(e.a) && ids.has(e.b))
    .sort((x, y) => y.amount - x.amount || byNorm(x.a, y.a) || byNorm(x.b, y.b));
  return { nodes, edges };
}

export const statsRoutes = new Hono<Env>()
  // ------------------------------------------------------- heatmap (総草)
  .get("/heatmap", async (c) => {
    const parsed = heatmapQuerySchema.safeParse({
      from: c.req.query("from"),
      to: c.req.query("to"),
    });
    if (!parsed.success) return fail(c, "validation_error");
    const window = resolveWindow(parsed.data, Date.now());
    if (window === null) return fail(c, "validation_error");
    const { from, to } = window;

    // Only the plaintext axis leaves D1: the 苔片 whose days OVERLAP the window
    // — `first_day <= to AND last_day >= from`, the one way every period in
    // this app is cut (ADR-0005) — as their two days and 向き. No JOIN: every
    // 苔片 counts, tagged or not. Bodies stay encrypted and untouched, which is
    // why this route has no BODY_KEY gate (ADR-0001): the moss is drawable even
    // while the key is missing.
    const rows = await createDb(c.env.DB)
      .select({ firstDay: post.firstDay, lastDay: post.lastDay, kind: post.kind })
      .from(post)
      .where(
        and(eq(post.userId, c.get("userId")), lte(post.firstDay, to), gte(post.lastDay, from)),
      );

    // `total` is the 苔片 overlapping the window — the caption's 「計 N 片」 —
    // not the cells' sum, which a 続く苔片 would inflate by its length; the
    // 向き totals beside it are counted the same way.
    return c.json({ from, to, ...heatmapTotals(rows), days: buildHeatmap(rows, from, to) });
  })
  // --------------------------------------------- tag timeline (石の年表, §8)
  .get("/timeline", async (c) => {
    const parsed = timelineQuerySchema.safeParse({
      focus: c.req.query("focus"),
      tags: c.req.query("tags"),
    });
    if (!parsed.success) return fail(c, "validation_error");

    const userId = c.get("userId");
    const db = createDb(c.env.DB);
    // The axis's right edge for every form — the client never re-decides "today".
    const today = dayKey(Date.now());

    // Shared SELECT list: span + count per tag, grouped (the count is the
    // honest 枚数; the 量 is folded from the axis rows below). Which postTags
    // column names the tag differs per form, so the join shape is built at
    // each site.
    const spanColumns = {
      id: tag.id,
      name: tag.name,
      norm: tag.norm,
      first: min(post.firstDay),
      last: max(post.lastDay),
      count: count(),
    };
    const ownPosts = eq(post.userId, userId);
    // The raw axis for the 量 and the month segments (§8, ADR-0007): one row
    // per (苔片, tag) link with the 苔片's days and 厚み, summed and walked into
    // months in core. Each form batches it with its span SQL — one D1 round
    // trip, one snapshot — so a row's 量 and months cover exactly the 苔片 its
    // count counts.
    const axisColumns = {
      tagId: postTags.tagId,
      firstDay: post.firstDay,
      lastDay: post.lastDay,
      thickness: post.thickness,
    };
    const setAxisColumns = { firstDay: post.firstDay, lastDay: post.lastDay, thickness: post.thickness };

    // ---- ?tags=t1,t2,…: the one AND row — posts carrying the whole set.
    if (parsed.data.tags !== undefined) {
      const ids = parseTagsParam(parsed.data.tags);
      if (ids === null) return fail(c, "validation_error");

      // data-model.md 集計節: posts where COUNT(DISTINCT tag_id ∈ set) = n,
      // aggregated outside. A post links a tag at most once (PK), so the inner
      // GROUP BY sees each (post, tag) pair once.
      const matched = db
        .select({ postId: postTags.postId })
        .from(postTags)
        .where(inArray(postTags.tagId, ids))
        .groupBy(postTags.postId)
        .having(eq(countDistinct(postTags.tagId), ids.length));
      const inSet = and(ownPosts, inArray(post.id, matched));
      const aggQuery = db
        .select({ first: min(post.firstDay), last: max(post.lastDay), count: count() })
        .from(post)
        .where(inSet);
      // The set's 苔片 themselves — no tag column needed, the one row is the set.
      const axisQuery = db.select(setAxisColumns).from(post).where(inSet);
      // The user filter is belt and braces against echoing a foreign name:
      // count ≥ 1 below proves every id is a real tag on the user's own posts.
      const namedQuery = db
        .select({ id: tag.id, name: tag.name })
        .from(tag)
        .where(and(eq(tag.userId, userId), inArray(tag.id, ids)));
      const [aggRows, axis, named] = await db.batch([aggQuery, axisQuery, namedQuery]);

      // No 苔片 carries the whole set (an unknown id lands here too — nothing
      // can carry it): an empty 年表, not an error, same as posts' unknown ?tag=.
      const agg = aggRows[0];
      if (agg === undefined || agg.count === 0 || agg.first === null || agg.last === null) {
        return c.json({ today, rows: [] });
      }

      const byId = new Map(named.map((t) => [t.id, t] as const));
      const tagsInOrder = ids.flatMap((id) => {
        const hit = byId.get(id);
        return hit ? [hit] : [];
      });
      if (tagsInOrder.length !== ids.length) return c.json({ today, rows: [] });

      const amounts = rowAmounts(axis);
      const row: TimelineRow = {
        tags: tagsInOrder,
        firstDay: agg.first,
        lastDay: agg.last,
        count: agg.count,
        amount: amounts.amount,
        months: amounts.months,
      };
      return c.json({ today, rows: [row] });
    }

    // ---- ?focus=t1[,t2,…]: the chosen stones — 選んだ石 — as one row, then
    // set × each co-occurring stone: the 内訳年表 in one round trip. One id is
    // the 1-stone form the 年表 has drawn since #30; more ids generalise it
    // (docs/plans/tabs-and-stones.md, 2026-09-07): the 苔片 are those carrying
    // the WHOLE set (the same HAVING as ?tags=), and the co-occurring stones
    // are every other tag on them. Five statements, one D1 batch, one snapshot.
    if (parsed.data.focus !== undefined) {
      const ids = parseFocusParam(parsed.data.focus);
      if (ids === null) return fail(c, "validation_error");

      const matched = db
        .select({ postId: postTags.postId })
        .from(postTags)
        .where(inArray(postTags.tagId, ids))
        .groupBy(postTags.postId)
        .having(eq(countDistinct(postTags.tagId), ids.length));
      const inSet = and(ownPosts, inArray(post.id, matched));
      const aggQuery = db
        .select({ first: min(post.firstDay), last: max(post.lastDay), count: count() })
        .from(post)
        .where(inSet);
      const setAxisQuery = db.select(setAxisColumns).from(post).where(inSet);
      const namedQuery = db
        .select({ id: tag.id, name: tag.name })
        .from(tag)
        .where(and(eq(tag.userId, userId), inArray(tag.id, ids)));
      // The other stones on the set's 苔片: the set's own links drop out, so a
      // 苔片 carrying nothing but the set contributes no row here.
      const others = and(inSet, notInArray(postTags.tagId, ids));
      const coocQuery = db
        .select(spanColumns)
        .from(postTags)
        .innerJoin(post, eq(postTags.postId, post.id))
        .innerJoin(tag, eq(postTags.tagId, tag.id))
        .where(others)
        .groupBy(tag.id, tag.name, tag.norm);
      const coocAxisQuery = db
        .select(axisColumns)
        .from(postTags)
        .innerJoin(post, eq(postTags.postId, post.id))
        .where(others);
      const [aggRows, setAxis, named, cooc, coocAxis] = await db.batch([
        aggQuery,
        setAxisQuery,
        namedQuery,
        coocQuery,
        coocAxisQuery,
      ]);
      return c.json({
        today,
        rows: buildFocusRows({ ids, agg: aggRows[0], named, setAxis, cooc, coocAxis }),
      });
    }

    // ---- default: every tag as one row, 開始日順 — the whole 年表. Archived
    // stones stay in on purpose: this chart is the history, not the composer's
    // suggestion list (tags route), and hiding them would erase read periods.
    const spanQuery = db
      .select(spanColumns)
      .from(postTags)
      .innerJoin(post, eq(postTags.postId, post.id))
      .innerJoin(tag, eq(postTags.tagId, tag.id))
      .where(ownPosts)
      .groupBy(tag.id, tag.name, tag.norm);
    const axisQuery = db
      .select(axisColumns)
      .from(postTags)
      .innerJoin(post, eq(postTags.postId, post.id))
      .where(ownPosts);
    const [raw, axis] = await db.batch([spanQuery, axisQuery]);
    const byTag = rowAmountsByTag(axis);
    const rows: TimelineRow[] = buildTagSpans(raw).map((s) => {
      const amounts = byTag.get(s.tag.id) ?? NO_AMOUNTS;
      return {
        tags: [s.tag],
        firstDay: s.firstDay,
        lastDay: s.lastDay,
        count: s.count,
        amount: amounts.amount,
        months: amounts.months,
      };
    });
    return c.json({ today, rows });
  })
  // ---------------------------------------- tag graph (石のつながり, §6)
  .get("/graph", async (c) => {
    const parsed = graphQuerySchema.safeParse({ period: c.req.query("period") });
    if (!parsed.success) return fail(c, "validation_error");
    const period = parsed.data.period ?? "all";

    const userId = c.get("userId");
    const db = createDb(c.env.DB);
    const ownPosts = eq(post.userId, userId);
    // 今月 / 今年 by overlap (ADR-0005): a 苔片 is in the period if it was still
    // there on the period's first day — `last_day >= 初日`; no 苔片 ends after
    // today, so that is the whole test. The same period is the window the 量
    // is clipped to in core (ADR-0007): 初日 to today; 全期間 clips nothing.
    const now = Date.now();
    const window: DayWindow | undefined =
      period === "all" ? undefined : { from: periodStartDay(period, now), to: dayKey(now) };
    const inPeriod = window === undefined ? ownPosts : and(ownPosts, gte(post.lastDay, window.from));

    // One row per (苔片, stone) link, and the §6 self-join of data-model.md's
    // 集計節, one row per (苔片, pair): `a.tag_id < b.tag_id` hands each pair
    // exactly once per 苔片. Not grouped — the 量 needs each 苔片's days and 厚み,
    // and the summing is core's (buildGraph). Batched — two statements, one D1
    // round trip, like the timeline's focus form.
    const stacking = { firstDay: post.firstDay, lastDay: post.lastDay, thickness: post.thickness };
    const nodesQuery = db
      .select({ id: tag.id, name: tag.name, norm: tag.norm, color: tag.color, ...stacking })
      .from(postTags)
      .innerJoin(post, eq(postTags.postId, post.id))
      .innerJoin(tag, eq(postTags.tagId, tag.id))
      .where(inPeriod);
    const a = alias(postTags, "a");
    const b = alias(postTags, "b");
    const edgesQuery = db
      .select({
        // Both sides are `tag_id`, and D1's batch API hands rows back as
        // objects (no raw mode), where duplicate column names clobber each
        // other and derail drizzle's positional mapping — so alias them apart.
        a: sql<string>`${a.tagId}`.as("a"),
        b: sql<string>`${b.tagId}`.as("b"),
        ...stacking,
      })
      .from(a)
      .innerJoin(b, and(eq(b.postId, a.postId), lt(a.tagId, b.tagId)))
      .innerJoin(post, eq(a.postId, post.id))
      .where(inPeriod);
    const [nodeRows, edgeRows] = await db.batch([nodesQuery, edgesQuery]);
    return c.json(buildGraph(nodeRows, edgeRows, window));
  });
