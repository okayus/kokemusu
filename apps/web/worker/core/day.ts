// The day axis (CONTEXT.md 「日」, ADR-0005): the unit 苔片 stack into, and one
// cell of the heatmap. A 苔片 stores the days it was there — `first_day` and
// `last_day`, JST calendar days as `YYYY-MM-DD` text — so on the read side a
// day is compared, enumerated and bucketed as a string and no zone is involved.
// The zone enters exactly once, on the write side: `dayKey(now)` is the day a
// 苔片 stacked "now" lands on, decided here, in Asia/Tokyo, and nowhere else.
//
// Why not in SQL: `date(created_at / 1000, 'unixepoch')` cuts days in UTC, so
// every 苔片 written before 09:00 JST would land on the previous day. Adding a
// fixed `+9 hours` instead only hides that until the constant moves. Both are
// wrong the same way — a day is a calendar fact in a time zone — so the
// conversion goes through Intl, from the zone, in one place. (Migration 0004
// used the `+9h` form exactly once, to backfill rows that all predate the
// axis: one statement over a zone with no DST, not a pattern.)
//
// Everything here is pure: no clock, no I/O, same arguments -> same result.
// `tz` is a parameter (the app always passes APP_TZ, and `user` has no TZ
// column by decision — docs/data-model.md) so the boundary tests can drive
// zones that have DST. Tokyo has had none since 1951, which is exactly why a
// Tokyo-only implementation could be wrong without anyone noticing.

// Temporal is where `dayKey` would live (`Instant.toZonedDateTimeISO(tz).toPlainDate()`) —
// but it is not available to us: checked 2026-09-01, workerd 2026-08-20 has no `Temporal`
// global (not even under --all-autogates), node 24 only behind --harmony-temporal, and
// TypeScript 7.0.2 ships no types for it. So this module is that API's replacement, and
// only `dayKey` touches a zone — the swap, when it lands, is that one body. It was
// differentially tested against Temporal as an oracle (53k values, 13 zones incl.
// 30-minute DST, negative DST, midnight transitions, and Samoa's skipped 2011-12-30):
// no disagreement.

import { isInput, isOutput, type PostKind } from "./kind";

/** The one time zone this instance cuts days in (docs/data-model.md, 2026-08-23). */
export const APP_TZ = "Asia/Tokyo";

/** A calendar day in some zone, ISO `YYYY-MM-DD`. Sorts lexicographically = chronologically. */
export type DayKey = string;

/** A calendar month in some zone, ISO `YYYY-MM` — a DayKey's first 7 chars, so it sorts the same way. */
export type MonthKey = string;

/** A `YYYY-MM-DD` day key taken apart. Month is 1-based, unlike `Date`. */
export type CivilDate = { year: number; month: number; day: number };

/** The days a 苔片 was there, both inclusive (ADR-0005). A single-day 苔片 has the two equal. */
export type DaySpan = { firstDay: DayKey; lastDay: DayKey };

/** What grew on one day: every 苔片 there, and the two sides of its 向き (core/kind.ts). */
export type DayTally = { count: number; input: number; output: number };

const MS_PER_DAY = 86_400_000;
/** ECMA-262 time-value range: ±100,000,000 days around the epoch. */
const MAX_TIME_VALUE = 8_640_000_000_000_000;
/** ~100 years. A span this wide is a caller bug, not a request: the heatmap
 *  route caps its window far below, and 4-digit years could otherwise ask for
 *  3.6M strings in a 128 MB Worker. */
const MAX_SPAN_DAYS = 36_600;
/** The same ~100 years, in months — the ceiling of a 続く苔片's month walk. */
const MAX_SPAN_MONTHS = 1200;

const DAY_KEY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

// Building an Intl.DateTimeFormat costs orders of magnitude more than using
// one, and a burst of writes calls dayKey repeatedly — so they are memoized
// per zone. Observationally pure: the cache is keyed by `tz` and can only
// change how long a call takes. Intl throws on anything that is not a real
// zone, so nothing but the tz database can ever land in this map.
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

// `-u-ca-iso8601` pins the proleptic Gregorian calendar (no era-relative years
// from a locale's default calendar); formatToParts keeps us off locale
// patterns entirely — we read fields, never a formatted string.
function dayFormatter(tz: string): Intl.DateTimeFormat {
  let cached = dayFormatters.get(tz);
  if (cached === undefined) {
    cached = new Intl.DateTimeFormat("en-US-u-ca-iso8601", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(tz, cached);
  }
  return cached;
}

function numericPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const hit = parts.find((p) => p.type === type);
  if (hit === undefined) throw new RangeError(`day: Intl returned no ${type} part`);
  return Number(hit.value);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function toDayKey(civil: CivilDate): DayKey {
  return `${pad(civil.year, 4)}-${pad(civil.month, 2)}-${pad(civil.day, 2)}`;
}

/** Midnight of a civil date read as if it were UTC — the carrier for calendar math. */
function civilToUtcMs(civil: CivilDate): number {
  // `Date.UTC` maps years 0–99 into the 1900s; `setUTCFullYear` does not. The
  // epoch anchor is already 00:00:00.000Z, so only the date fields move — and
  // out-of-range fields (month 13, day 32) roll over, which is what
  // `parseDayKey` uses to reject days the calendar does not have.
  const d = new Date(0);
  d.setUTCFullYear(civil.year, civil.month - 1, civil.day);
  return d.getTime();
}

function utcMsToCivil(ms: number): CivilDate {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function assertInstant(epochMs: number): void {
  if (!Number.isInteger(epochMs) || Math.abs(epochMs) > MAX_TIME_VALUE) {
    throw new RangeError("day: epochMs must be a whole number of ms inside the Date range");
  }
}

function requireCivil(day: DayKey): CivilDate {
  const civil = parseDayKey(day);
  if (civil === null) throw new RangeError("day: not a YYYY-MM-DD day key");
  return civil;
}

function requireSpan(span: DaySpan): void {
  requireCivil(span.firstDay);
  requireCivil(span.lastDay);
  // Both keys are valid 4-digit-year days here, so the string order is the day order.
  if (span.lastDay < span.firstDay) throw new RangeError("day: span ends before it begins");
}

/**
 * The day an instant belongs to — the write side's one question: a 苔片
 * stacked "now" gets `first_day = last_day = dayKey(now)`, and `today` on the
 * wire is `dayKey(Date.now())`.
 *
 * @throws RangeError on a non-integer / out-of-range timestamp, or an unknown
 * zone (Intl) — a broken timestamp must not silently pick a neighbouring day.
 */
export function dayKey(epochMs: number, tz: string = APP_TZ): DayKey {
  assertInstant(epochMs);
  const parts = dayFormatter(tz).formatToParts(epochMs);
  return toDayKey({
    year: numericPart(parts, "year"),
    month: numericPart(parts, "month"),
    day: numericPart(parts, "day"),
  });
}

/**
 * A `YYYY-MM-DD` string taken apart, or null if it is not a day the calendar
 * has (`2026-02-30`, `2026-13-01`, `2026-9-1`). Days come off the wire as
 * `?from=` / `?to=` (and, from A2 on, as the days to stack on), so nothing
 * unvalidated reaches the SQL.
 */
export function parseDayKey(raw: string): CivilDate | null {
  if (!DAY_KEY_SHAPE.test(raw)) return null;
  const civil = {
    year: Number(raw.slice(0, 4)),
    month: Number(raw.slice(5, 7)),
    day: Number(raw.slice(8, 10)),
  };
  // Rollover is the test: 2026-02-30 becomes March 2, which is not what we parsed.
  const roundTrip = utcMsToCivil(civilToUtcMs(civil));
  if (
    roundTrip.year !== civil.year ||
    roundTrip.month !== civil.month ||
    roundTrip.day !== civil.day
  ) {
    return null;
  }
  return civil;
}

export function isDayKey(raw: string): boolean {
  return parseDayKey(raw) !== null;
}

/**
 * Calendar arithmetic on a day key, deliberately carried out in UTC: a day key
 * is a civil date, and UTC days are all exactly 24 h, so no DST jump can eat
 * or duplicate one.
 *
 * @throws RangeError on a malformed key, a fractional delta, or a result off
 * the calendar.
 */
export function addDays(day: DayKey, delta: number): DayKey {
  const civil = requireCivil(day);
  if (!Number.isInteger(delta)) throw new RangeError("day: delta must be a whole number of days");
  const shifted = civilToUtcMs(civil) + delta * MS_PER_DAY;
  if (!Number.isFinite(shifted) || Math.abs(shifted) > MAX_TIME_VALUE) {
    throw new RangeError("day: shifted day falls outside the Date range");
  }
  return toDayKey(utcMsToCivil(shifted));
}

/**
 * Day of the week of a day key, 0 = Sunday … 6 = Saturday. A civil date's
 * weekday is a calendar fact with no zone in it, so this rides the same UTC
 * carrier as `addDays`. It is the heatmap's row axis (weeks start on Sunday —
 * plans/vertical-slice.md) and how the default window snaps to a week start.
 *
 * @throws RangeError on a malformed day key.
 */
export function dayOfWeek(day: DayKey): number {
  return new Date(civilToUtcMs(requireCivil(day))).getUTCDay();
}

/**
 * Every day from `from` to `to`, inclusive and ascending — the heatmap's grid
 * before any counts are laid on it, and the days a 続く苔片 was there. An
 * inverted range is an empty span rather than a throw; the route rejects that
 * with a 400 before it gets here.
 *
 * @throws RangeError on a malformed key or an absurdly wide span (see MAX_SPAN_DAYS).
 */
export function enumerateDays(from: DayKey, to: DayKey): DayKey[] {
  const start = civilToUtcMs(requireCivil(from));
  const end = civilToUtcMs(requireCivil(to));
  if (end < start) return [];
  if ((end - start) / MS_PER_DAY + 1 > MAX_SPAN_DAYS) {
    throw new RangeError("day: span too wide to enumerate");
  }
  const days: DayKey[] = [];
  for (let t = start; t <= end; t += MS_PER_DAY) days.push(toDayKey(utcMsToCivil(t)));
  return days;
}

/**
 * The month a day is in — `YYYY-MM`, the 年表's 活動月 bucket (visualization.md
 * §8). A day key already carries its zone's calendar, so this is a cut of the
 * string, not a conversion.
 *
 * @throws RangeError on a malformed day key.
 */
export function monthOf(day: DayKey): MonthKey {
  requireCivil(day);
  return day.slice(0, 7);
}

/**
 * Every month from `from`'s to `to`'s, inclusive and ascending — the months a
 * 続く苔片 touches. An inverted pair is an empty span, like `enumerateDays`.
 *
 * @throws RangeError on a malformed key or an absurdly wide span (see MAX_SPAN_MONTHS).
 */
export function enumerateMonths(from: DayKey, to: DayKey): MonthKey[] {
  const start = requireCivil(from);
  const end = requireCivil(to);
  const first = start.year * 12 + (start.month - 1);
  const last = end.year * 12 + (end.month - 1);
  if (last < first) return [];
  if (last - first + 1 > MAX_SPAN_MONTHS) {
    throw new RangeError("day: span too wide to enumerate by month");
  }
  const months: MonthKey[] = [];
  for (let m = first; m <= last; m++) {
    months.push(`${pad(Math.floor(m / 12), 4)}-${pad((m % 12) + 1, 2)}`);
  }
  return months;
}

/**
 * Fold 苔片 spans into "what was there on each day" of the window `from`..`to`
 * — the whole heatmap aggregation, on plaintext metadata only (ADR-0001:
 * bodies stay encrypted and are never touched to draw the moss). A 続く苔片
 * counts once on every day it was there (CONTEXT.md: 在った 1 片, not 毎日 1 片);
 * a day no 苔片 touched is simply absent. Spans are clipped to the window, so
 * what lies outside costs nothing and a span wholly outside contributes nothing.
 *
 * Pair it with `enumerateDays` for the dense ascending series the SVG draws:
 *
 *     const tallies = bucketSpansByDay(rows, from, to);
 *     enumerateDays(from, to).map((day) => ({ day, count: tallies.get(day)?.count ?? 0 }));
 *
 * @throws RangeError on a malformed key or an inverted span — a broken row
 * must not silently light the wrong cells.
 */
export function bucketSpansByDay(
  spans: Iterable<DaySpan & { kind: PostKind | null }>,
  from: DayKey,
  to: DayKey,
): Map<DayKey, DayTally> {
  requireCivil(from);
  requireCivil(to);
  const tallies = new Map<DayKey, DayTally>();
  for (const span of spans) {
    requireSpan(span);
    const lo = span.firstDay < from ? from : span.firstDay;
    const hi = span.lastDay > to ? to : span.lastDay;
    if (hi < lo) continue;
    const input = isInput(span.kind) ? 1 : 0;
    const output = isOutput(span.kind) ? 1 : 0;
    for (const day of enumerateDays(lo, hi)) {
      let tally = tallies.get(day);
      if (tally === undefined) {
        tally = { count: 0, input: 0, output: 0 };
        tallies.set(day, tally);
      }
      tally.count += 1;
      tally.input += input;
      tally.output += output;
    }
  }
  return tallies;
}

/**
 * Fold 苔片 spans into "how many were there in each month" — `bucketSpansByDay`'s
 * sibling for the 年表's month segments (visualization.md §8). A 続く苔片 counts
 * once in every month it touches, so over a row these add up to AT LEAST the
 * row's 苔片 count — equal while every 苔片 is a single day.
 *
 * @throws RangeError as `bucketSpansByDay`, and on a span wider than MAX_SPAN_MONTHS.
 */
export function bucketSpansByMonth(spans: Iterable<DaySpan>): Map<MonthKey, number> {
  const counts = new Map<MonthKey, number>();
  for (const span of spans) {
    requireSpan(span);
    for (const month of enumerateMonths(span.firstDay, span.lastDay)) {
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
  }
  return counts;
}
