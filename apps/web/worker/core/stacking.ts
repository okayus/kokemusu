// The days a 苔片 stacks on, as a sum type (CONTEXT.md 続く苔片・厚み・量,
// ADR-0007): a single day, or a range with a 厚み. Not "two days and a nullable
// number" — a range without a 厚み and a single day with one are not things,
// and the type has no case for them. The same two cases are carved into the
// `post` table as three CHECKs (db/schema.ts), interpreted off the wire by
// `parseStacking`, decoded from a row by `decodeStacking`, and written back
// by `encodeStacking` — the one place a NULL is born. core takes a `Stacking`
// and never a `thickness: number | null`.
//
// 量 (amount) is derived, never stored: a single day is 1 (one sheet — one day
// at 100%), a range is its days × 厚み / 100, clipped to a window when one is
// given. Everything here is pure; `today` is an argument.

import { z } from "zod";
import { countDays, earliestStackDay, isDayKey, type DayKey, type DaySpan } from "./day";

/**
 * 厚み as declared: the share of a range's days it was worked on, a whole
 * percentage 1..100 (features.md §1: 月 20 営業日 ≒ 60). The only constructor of
 * the brand — a `Thickness` exists because this schema said so.
 */
export const thicknessSchema = z.int().min(1).max(100).brand<"Thickness">();
export type Thickness = z.infer<typeof thicknessSchema>;

/**
 * The days a 苔片 stacks on. `day`: one 「日」, no 厚み — one sheet IS one day at
 * 100%. `days`: a 続く苔片, `firstDay < lastDay` (strictly: a range of one day
 * is a `day`), with the 厚み it declares.
 */
export type Stacking =
  | { on: "day"; day: DayKey }
  | { on: "days"; firstDay: DayKey; lastDay: DayKey; thickness: Thickness };

/** What the wire and the row both say about the days: two optional day keys and a 厚み that may be absent or null. */
export type StackingInput = {
  firstDay?: string | undefined;
  lastDay?: string | undefined;
  thickness?: number | null | undefined;
};

/** The row's (and the response's) shape — NULL ⇔ single day, exactly as the table's CHECK 2 has it. */
export type StackingRow = { firstDay: DayKey; lastDay: DayKey; thickness: number | null };

/** The window 量 is clipped to, both days inclusive. */
export type DayWindow = { from: DayKey; to: DayKey };

/**
 * Interpret what came off the wire as a `Stacking`, or null when it names
 * nothing the type has a case for — the route answers 400 to null. Not a
 * validator that lets a shape through but the one reading of it:
 *
 *  - an absent `firstDay` is `today` (a 苔片 stacked now), an absent `lastDay`
 *    is `firstDay` (a single day);
 *  - both must be calendar days, `firstDay ≤ lastDay ≤ today` — nothing is
 *    stacked on a day that has not come; a 続く苔片 still going ends on today
 *    and is lengthened later — and no earlier than `earliestStackDay(today)`;
 *  - equal days are a `day`, and a `day` has no 厚み: a number here is null
 *    (the sender said something the 苔片 cannot mean), an absent or null 厚み
 *    is simply no 厚み;
 *  - different days are `days`, and `days` need their 厚み: absent or null is
 *    null (ADR-0007: no silent 100%), and it must be a `Thickness`.
 *
 * Never throws, whatever the input (`today` included — a malformed today is null).
 */
export function parseStacking(input: StackingInput, today: DayKey): Stacking | null {
  if (!isDayKey(today)) return null;
  const firstDay = input.firstDay ?? today;
  const lastDay = input.lastDay ?? firstDay;
  if (!isDayKey(firstDay) || !isDayKey(lastDay)) return null;
  // Day keys of 4-digit years order as strings, so these are string comparisons.
  if (!(earliestStackDay(today) <= firstDay && firstDay <= lastDay && lastDay <= today)) return null;
  const thickness = input.thickness ?? null;
  if (firstDay === lastDay) return thickness === null ? { on: "day", day: firstDay } : null;
  if (thickness === null) return null;
  const parsed = thicknessSchema.safeParse(thickness);
  return parsed.success ? { on: "days", firstDay, lastDay, thickness: parsed.data } : null;
}

/**
 * What an edit means for the days: a PATCH names only what it changes. A day
 * it leaves out keeps the row's own; the 厚み is three-valued — `undefined`
 * keeps the row's, `null` says "none" (right only together with a single day),
 * a number replaces it. Whatever results is read by `parseStacking`, so a
 * 苔片 shortened to one day while its 厚み stays, or lengthened into a range
 * without saying its 厚み, is null (400) — and `lastDay` alone lengthens a
 * 続く苔片 with its 厚み intact. `??` would fold null into undefined; the
 * three values are told apart on `=== undefined`.
 */
export function patchStacking(current: Stacking, patch: StackingInput, today: DayKey): Stacking | null {
  const row = encodeStacking(current);
  return parseStacking(
    {
      firstDay: patch.firstDay === undefined ? row.firstDay : patch.firstDay,
      lastDay: patch.lastDay === undefined ? row.lastDay : patch.lastDay,
      thickness: patch.thickness === undefined ? row.thickness : patch.thickness,
    },
    today,
  );
}

/**
 * A `post` row → its `Stacking`. The table's three CHECKs promise the shape,
 * so a row that breaks it — a single day with a 厚み, a range without one or
 * with one outside 1..100, an inverted range, a key that is not a day — is not
 * a request to be lenient with but a broken store, and throws (the reader
 * fails closed like a decrypt failure, never showing a 苔片 as something it
 * is not).
 *
 * @throws RangeError on a row the CHECKs would have refused.
 */
export function decodeStacking(row: StackingRow): Stacking {
  if (!isDayKey(row.firstDay) || !isDayKey(row.lastDay)) {
    throw new RangeError("stacking: row day is not a YYYY-MM-DD day key");
  }
  if (row.lastDay < row.firstDay) throw new RangeError("stacking: row range ends before it begins");
  if (row.firstDay === row.lastDay) {
    if (row.thickness !== null) throw new RangeError("stacking: single-day row carries a 厚み");
    return { on: "day", day: row.firstDay };
  }
  const parsed = thicknessSchema.safeParse(row.thickness);
  if (!parsed.success) throw new RangeError("stacking: range row has no 厚み in 1..100");
  return { on: "days", firstDay: row.firstDay, lastDay: row.lastDay, thickness: parsed.data };
}

/**
 * A `Stacking` → the row / wire shape. The only place `thickness: null` is
 * produced: it means "single day" here and nowhere else. `decodeStacking ∘
 * encodeStacking` is the identity.
 */
export function encodeStacking(s: Stacking): StackingRow {
  return s.on === "day"
    ? { firstDay: s.day, lastDay: s.day, thickness: null }
    : { firstDay: s.firstDay, lastDay: s.lastDay, thickness: s.thickness };
}

/**
 * Just the days — what the 総草 and the 年表's month walk take (core/day.ts).
 * That they take a `DaySpan` and not a `Stacking` is the type saying they do
 * not read the 量 (ADR-0007: the 総草 lights a day the 苔片 was there, 厚み or not).
 */
export function daySpanOf(s: Stacking): DaySpan {
  return s.on === "day" ? { firstDay: s.day, lastDay: s.day } : { firstDay: s.firstDay, lastDay: s.lastDay };
}

/** How many calendar days the 苔片 was there — 1 for a `day`. */
export function spanDays(s: Stacking): number {
  return s.on === "day" ? 1 : countDays(s.firstDay, s.lastDay);
}

/**
 * The 量 of a 苔片 (CONTEXT.md): a `day` is 1, `days` is its days × 厚み / 100
 * (731 days at 60 → 438.6, kept as a fraction — rounding is the display's).
 * With a `window`, only the days inside it count: a `days` clipped to the
 * overlap, a `day` outside it 0. So a window covering the whole 苔片 changes
 * nothing, and one it never touches gives 0.
 */
export function amountOf(s: Stacking, window?: DayWindow): number {
  if (s.on === "day") {
    return window === undefined || (window.from <= s.day && s.day <= window.to) ? 1 : 0;
  }
  const from = window === undefined || s.firstDay > window.from ? s.firstDay : window.from;
  const to = window === undefined || s.lastDay < window.to ? s.lastDay : window.to;
  if (to < from) return 0;
  return (countDays(from, to) * s.thickness) / 100;
}

/**
 * The 厚み as MEASURED over some days — the 年表's 「厚み x%」 (visualization.md
 * §8): 量 ÷ days, a plain ratio, not a `Thickness`. Several 苔片 on one day put
 * it over 1, and it is shown as such; 0 days is 0, not a division.
 */
export function measuredThickness(amount: number, days: number): number {
  return days > 0 ? amount / days : 0;
}
