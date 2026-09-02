import { and, count, countDistinct, eq, gte, inArray, isNull, lt, max, min, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { z } from "zod";
import {
  addDays,
  bucketByDay,
  dayKey,
  dayOfWeek,
  dayStartMs,
  enumerateDays,
  isDayKey,
  type DayKey,
} from "../core/day";
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
 * inverted, wider than MAX_WINDOW_DAYS, or touching the end of the 4-digit
 * calendar (`addDays(to, 1)` must stay on it).
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

/** One cell on the wire: the day, its 苔片 count, and the 0..4 shade. */
export type HeatmapDay = { day: DayKey; count: number; level: number };

/** Fold raw `created_at` instants into the dense ascending series the SVG draws. */
export function buildHeatmap(
  timestamps: Iterable<number>,
  from: DayKey,
  to: DayKey,
): HeatmapDay[] {
  const counts = bucketByDay(timestamps);
  return enumerateDays(from, to).map((day) => {
    const count = counts.get(day) ?? 0;
    return { day, count, level: Math.min(count, MAX_LEVEL) };
  });
}

// ---------------------------------------------------------------------------
// タグのタイムライン (visualization.md §8): rows of "first 苔片 → last 苔片" per
// tag set. Like the heatmap, this whole route reads plaintext metadata only —
// `created_at` and `post_tags` — so BODY_KEY never enters the path (ADR-0001)
// and the 年表 draws even while the key is missing. Day bucketing happens in
// core (`dayKey`, Asia/Tokyo), never via SQLite's UTC-based `date()`; SQL only
// takes MIN/MAX/COUNT over the raw epoch-ms axis, which is safe because
// `dayKey` is monotonic.

/** Mirrors posts' MAX_TAGS_PER_POST: an AND of more tags than a 苔片 can carry is empty by construction. */
export const TIMELINE_MAX_TAGS = 20;

// The three forms (docs/plans/tag-timeline.md): no param = one row per tag,
// `?focus=` = that stone + stone×co-occurring-tag rows, `?tags=` = one AND row.
// focus and tags are exclusive — a request mixing them has no meaning.
export const timelineQuerySchema = z
  .object({
    focus: z.string().min(1).max(64).optional(),
    tags: z.string().min(1).max(1400).optional(),
  })
  .refine((q) => q.focus === undefined || q.tags === undefined, "focus and tags are exclusive");

/**
 * `?tags=` parsed into 2..TIMELINE_MAX_TAGS unique ids in request order, or
 * null for a shape the route answers 400 to: an empty segment, an overlong id,
 * or a set that isn't a combination (fewer than 2 after dedupe — one tag is the
 * default/focus form's job).
 */
export function parseTagsParam(raw: string): string[] | null {
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.some((p) => p.length === 0 || p.length > 64)) return null;
  const ids = [...new Set(parts)];
  if (ids.length < 2 || ids.length > TIMELINE_MAX_TAGS) return null;
  return ids;
}

/** A stone on the wire — same shape the posts API uses for tags. */
export type TimelineTag = { id: string; name: string };

/** One row of the 年表: the tag set, its first/last day (JST), and the 苔片 count. */
export type TimelineRow = { tags: TimelineTag[]; firstDay: DayKey; lastDay: DayKey; count: number };

/** What the grouped SQL hands back per tag; `norm` rides along as the tiebreaker. */
export type RawTagSpan = {
  id: string;
  name: string;
  norm: string;
  first: number | null;
  last: number | null;
  count: number;
};

/** A per-tag span with the instants folded into JST days. */
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
      firstDay: dayKey(r.first),
      lastDay: dayKey(r.last),
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

    // Only the plaintext axis leaves D1: `created_at` inside the half-open
    // window [dayStartMs(from), dayStartMs(addDays(to, 1))). No JOIN — every
    // 苔片 counts, tagged or not. Bodies stay encrypted and untouched — which
    // is why this route has no BODY_KEY gate (ADR-0001): the moss is drawable
    // even while the key is missing.
    const rows = await createDb(c.env.DB)
      .select({ createdAt: post.createdAt })
      .from(post)
      .where(
        and(
          eq(post.userId, c.get("userId")),
          isNull(post.deletedAt),
          gte(post.createdAt, dayStartMs(from)),
          lt(post.createdAt, dayStartMs(addDays(to, 1))),
        ),
      );

    return c.json({
      from,
      to,
      days: buildHeatmap(
        rows.map((r) => r.createdAt),
        from,
        to,
      ),
    });
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

    // Shared SELECT list: span + count per tag, grouped. Which postTags column
    // names the tag differs per form, so the join shape is built at each site.
    const spanColumns = {
      id: tag.id,
      name: tag.name,
      norm: tag.norm,
      first: min(post.createdAt),
      last: max(post.createdAt),
      count: count(),
    };
    const liveOwnPosts = and(eq(post.userId, userId), isNull(post.deletedAt));

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
      const agg = (
        await db
          .select({ first: min(post.createdAt), last: max(post.createdAt), count: count() })
          .from(post)
          .where(and(liveOwnPosts, inArray(post.id, matched)))
      )[0];
      // No 苔片 carries the whole set (an unknown id lands here too — nothing
      // can carry it): an empty 年表, not an error, same as posts' unknown ?tag=.
      if (agg === undefined || agg.count === 0 || agg.first === null || agg.last === null) {
        return c.json({ today, rows: [] });
      }

      // count ≥ 1 proves every id is a real tag on the user's own posts; the
      // user filter here is belt and braces against echoing a foreign name.
      const named = await db
        .select({ id: tag.id, name: tag.name })
        .from(tag)
        .where(and(eq(tag.userId, userId), inArray(tag.id, ids)));
      const byId = new Map(named.map((t) => [t.id, t] as const));
      const tagsInOrder = ids.flatMap((id) => {
        const hit = byId.get(id);
        return hit ? [hit] : [];
      });
      if (tagsInOrder.length !== ids.length) return c.json({ today, rows: [] });

      const row: TimelineRow = {
        tags: tagsInOrder,
        firstDay: dayKey(agg.first),
        lastDay: dayKey(agg.last),
        count: agg.count,
      };
      return c.json({ today, rows: [row] });
    }

    // ---- ?focus=<tagId>: that stone alone + stone × each co-occurring tag —
    // the 内訳年表 in one round trip (batched: two statements, one D1 call).
    if (parsed.data.focus !== undefined) {
      const focusId = parsed.data.focus;
      const aloneQuery = db
        .select(spanColumns)
        .from(postTags)
        .innerJoin(post, eq(postTags.postId, post.id))
        .innerJoin(tag, eq(postTags.tagId, tag.id))
        .where(and(eq(postTags.tagId, focusId), liveOwnPosts))
        .groupBy(tag.id, tag.name, tag.norm);
      // The §6 co-occurrence self-join, pinned on one side: a = the focused
      // stone, b = every other tag on the same 苔片, grouped by b.
      const a = alias(postTags, "a");
      const b = alias(postTags, "b");
      const coocQuery = db
        .select(spanColumns)
        .from(a)
        .innerJoin(b, and(eq(b.postId, a.postId), ne(b.tagId, focusId)))
        .innerJoin(post, eq(a.postId, post.id))
        .innerJoin(tag, eq(b.tagId, tag.id))
        .where(and(eq(a.tagId, focusId), liveOwnPosts))
        .groupBy(tag.id, tag.name, tag.norm);
      const [aloneRaw, coocRaw] = await db.batch([aloneQuery, coocQuery]);

      // Unknown id or a stone whose 苔片 are all gone: empty, not an error.
      const alone = buildTagSpans(aloneRaw)[0];
      if (alone === undefined) return c.json({ today, rows: [] });

      const rows: TimelineRow[] = [
        { tags: [alone.tag], firstDay: alone.firstDay, lastDay: alone.lastDay, count: alone.count },
        ...buildTagSpans(coocRaw).map((s) => ({
          tags: [alone.tag, s.tag],
          firstDay: s.firstDay,
          lastDay: s.lastDay,
          count: s.count,
        })),
      ];
      return c.json({ today, rows });
    }

    // ---- default: every tag as one row, 開始日順 — the whole 年表. Archived
    // stones stay in on purpose: this chart is the history, not the composer's
    // suggestion list (tags route), and hiding them would erase read periods.
    const raw = await db
      .select(spanColumns)
      .from(postTags)
      .innerJoin(post, eq(postTags.postId, post.id))
      .innerJoin(tag, eq(postTags.tagId, tag.id))
      .where(liveOwnPosts)
      .groupBy(tag.id, tag.name, tag.norm);
    const rows: TimelineRow[] = buildTagSpans(raw).map((s) => ({
      tags: [s.tag],
      firstDay: s.firstDay,
      lastDay: s.lastDay,
      count: s.count,
    }));
    return c.json({ today, rows });
  });
