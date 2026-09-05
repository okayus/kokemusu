// The day axis (CONTEXT.md 「日」): the unit 苔片 stack into, and one cell of the
// heatmap. A 苔片 stores `created_at` — epoch ms, a UTC instant — and the day it
// falls in is decided here, in Asia/Tokyo, and nowhere else.
//
// Why not in SQL: `date(created_at / 1000, 'unixepoch')` cuts days in UTC, so
// every 苔片 written before 09:00 JST would light the previous day's cell.
// Adding a fixed `+9 hours` instead only hides that until the constant moves.
// Both are wrong the same way — a day is a calendar fact in a time zone — so
// the conversion goes through Intl, from the zone, in one place.
//
// Everything here is pure: no clock, no I/O, same arguments -> same result.
// `tz` is a parameter (the app always passes APP_TZ, and `user` has no TZ
// column by decision — docs/data-model.md) so the boundary tests can drive
// zones that have DST. Tokyo has had none since 1951, which is exactly why a
// Tokyo-only implementation could be wrong without anyone noticing.

// Temporal is where all of this would live (`Instant.toZonedDateTimeISO(tz).toPlainDate()`,
// `PlainDate.toZonedDateTime(tz).epochMilliseconds`) — but it is not available to us:
// checked 2026-09-01, workerd 2026-08-20 has no `Temporal` global (not even under
// --all-autogates), node 24 only behind --harmony-temporal, and TypeScript 7.0.2 ships no
// types for it. So this module is that API's replacement, and only `dayKey` / `dayStartMs`
// touch a zone — the swap, when it lands, is those two bodies. Both were differentially
// tested against Temporal as an oracle (53k values, 13 zones incl. 30-minute DST, negative
// DST, midnight transitions, and Samoa's skipped 2011-12-30): no disagreement, down to the
// "compatible" disambiguation of a local midnight that does not exist.

/** The one time zone this instance cuts days in (docs/data-model.md, 2026-08-23). */
export const APP_TZ = "Asia/Tokyo";

/** A calendar day in some zone, ISO `YYYY-MM-DD`. Sorts lexicographically = chronologically. */
export type DayKey = string;

/** A `YYYY-MM-DD` day key taken apart. Month is 1-based, unlike `Date`. */
export type CivilDate = { year: number; month: number; day: number };

const MS_PER_DAY = 86_400_000;
/** ECMA-262 time-value range: ±100,000,000 days around the epoch. */
const MAX_TIME_VALUE = 8_640_000_000_000_000;
/** ~100 years. A span this wide is a caller bug, not a request: the heatmap
 *  route caps its window far below, and 4-digit years could otherwise ask for
 *  3.6M strings in a 128 MB Worker. */
const MAX_SPAN_DAYS = 36_600;

const DAY_KEY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

// Building an Intl.DateTimeFormat costs orders of magnitude more than using
// one, and a year of heatmap rows calls dayKey hundreds of times — so they are
// memoized per zone. Observationally pure: the cache is keyed by `tz` and can
// only change how long a call takes. Intl throws on anything that is not a
// real zone, so nothing but the tz database can ever land in these maps.
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const clockFormatters = new Map<string, Intl.DateTimeFormat>();

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

function clockFormatter(tz: string): Intl.DateTimeFormat {
  let cached = clockFormatters.get(tz);
  if (cached === undefined) {
    cached = new Intl.DateTimeFormat("en-US-u-ca-iso8601", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    clockFormatters.set(tz, cached);
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

/** Offset of `tz` at an instant, in ms east of UTC (JST = +9h, EST = −5h). */
function offsetMsAt(tz: string, instantMs: number): number {
  const parts = clockFormatter(tz).formatToParts(instantMs);
  const localAsUtc =
    civilToUtcMs({
      year: numericPart(parts, "year"),
      month: numericPart(parts, "month"),
      day: numericPart(parts, "day"),
    }) +
    numericPart(parts, "hour") * 3_600_000 +
    numericPart(parts, "minute") * 60_000 +
    numericPart(parts, "second") * 1000;
  // The parts stop at whole seconds, so compare against the same resolution —
  // otherwise a timestamp's stray ms would show up as part of the offset.
  return localAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The day an instant belongs to. `dayKey(t)` is the only answer to "which cell
 * does this 苔片 light up".
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
 * `?from=` / `?to=`, so nothing unvalidated reaches the SQL window.
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
 * The instant a day begins in `tz` — the inverse of `dayKey`, and the lower
 * bound of the heatmap's `created_at` window (`>= dayStartMs(from)` and
 * `< dayStartMs(addDays(to, 1))`, so the window stays half-open and no 苔片
 * is counted twice).
 *
 * @throws RangeError on a malformed day key.
 */
export function dayStartMs(day: DayKey, tz: string = APP_TZ): number {
  const midnightAsUtc = civilToUtcMs(requireCivil(day));
  // Read local midnight with the offset in force *around* it, then re-read it
  // with the offset actually in force at that candidate: a DST change between
  // the two moves the answer by the jump.
  const first = midnightAsUtc - offsetMsAt(tz, midnightAsUtc);
  const second = midnightAsUtc - offsetMsAt(tz, first);
  if (second === first) return first;
  // `second` is right whenever local midnight exists. When a spring-forward
  // skips midnight itself (Santiago jumps 24:00 -> 01:00), `second` lands back
  // on the previous day; the day then begins at the transition, which is
  // `first`. Never reached under APP_TZ — Tokyo has no DST.
  return dayKey(second, tz) === day ? second : first;
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
 * before any counts are laid on it. An inverted range is an empty span rather
 * than a throw; the route rejects that with a 400 before it gets here.
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
 * Fold 苔片 timestamps into "how many on each day" — the whole heatmap
 * aggregation, working on plaintext metadata only (ADR-0001: bodies stay
 * encrypted and are never touched to draw the moss).
 *
 * Iteration order is the input's; pair it with `enumerateDays` for the dense
 * ascending series the SVG draws:
 *
 *     const counts = bucketByDay(rows.map((r) => r.createdAt));
 *     enumerateDays(from, to).map((day) => ({ day, count: counts.get(day) ?? 0 }));
 */
export function bucketByDay(
  timestamps: Iterable<number>,
  tz: string = APP_TZ,
): Map<DayKey, number> {
  const counts = new Map<DayKey, number>();
  for (const epochMs of timestamps) {
    const key = dayKey(epochMs, tz);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** A calendar month in some zone, ISO `YYYY-MM` — a DayKey's first 7 chars, so it sorts the same way. */
export type MonthKey = string;

/**
 * The month an instant belongs to: `dayKey` cut to `YYYY-MM`, so a 苔片 is in
 * the month its day is in — 08:00 JST on the 1st is still last month on the
 * UTC calendar, and `strftime('%Y-%m', …)` in SQL would file it there. The
 * bucket of the 年表's month segments (visualization.md §8, 活動月).
 *
 * @throws RangeError as `dayKey`.
 */
export function monthKey(epochMs: number, tz: string = APP_TZ): MonthKey {
  return dayKey(epochMs, tz).slice(0, 7);
}

/**
 * Fold 苔片 timestamps into "how many in each month" — `bucketByDay`'s
 * sibling for the month segments. Same diet: instants only, never a body.
 */
export function bucketByMonth(
  timestamps: Iterable<number>,
  tz: string = APP_TZ,
): Map<MonthKey, number> {
  const counts = new Map<MonthKey, number>();
  for (const epochMs of timestamps) {
    const key = monthKey(epochMs, tz);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
