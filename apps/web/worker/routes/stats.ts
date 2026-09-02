import { and, eq, gte, isNull, lt } from "drizzle-orm";
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
import { post } from "../db/schema";
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
  });
