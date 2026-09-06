// The days a 苔片 stacks on, browser side — the mirror of worker/core/day.ts's
// write-side rules (the SPA must not import Worker modules, so the little that
// the composer and the cards need is spelled once more here). A 苔片 carries
// `firstDay` / `lastDay` (the 「日」 it was there, ADR-0005) and `postedDay`
// (the day it was written on); all three are the server's `YYYY-MM-DD` keys and
// this module only compares and formats them — no clock, no zone.

import { slashDay } from "./period";

/**
 * How far back a 苔片 may be stacked: 1200 months, today's month included — the
 * same ceiling as the Worker's month walk (worker/core/day.ts MAX_SPAN_MONTHS),
 * which is why the number is here at all. The route is the check that counts;
 * this is the date fields' `min`, so the browser says no before the server has to.
 */
const STACK_MONTHS = 1200;

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** The 1st of the month STACK_MONTHS months back from `today`'s — the fields' `min`. */
export function earliestStackDay(today: string): string {
  const month = +today.slice(0, 4) * 12 + (+today.slice(5, 7) - 1) - (STACK_MONTHS - 1);
  return `${pad(Math.floor(month / 12), 4)}-${pad((month % 12) + 1, 2)}-01`;
}

/** The three days a 苔片 carries on the wire. */
export type PostDays = { firstDay: string; lastDay: string; postedDay: string };

/**
 * 「いま積んだ」: stacked on the day it was written, and on that day alone.
 * Such a card shows the time; every other 苔片 shows its days instead
 * (features.md §1). A comparison of the server's keys, nothing more.
 */
export const isStackedNow = (post: PostDays): boolean =>
  post.firstDay === post.lastDay && post.firstDay === post.postedDay;

/** The card's days: 「2025/03/01」 for a day, 「2025/03/01 〜 2026/01/31」 for a 続く苔片. */
export const daysLabel = (firstDay: string, lastDay: string): string =>
  firstDay === lastDay ? slashDay(firstDay) : `${slashDay(firstDay)} 〜 ${slashDay(lastDay)}`;

/**
 * The day a past 苔片 was written on, short — 「9/6」 — since the card already
 * names the year in its days; the year comes back only when it differs from
 * the last day's, where 「1/5」 alone could be either side of New Year.
 */
export function postedLabel(postedDay: string, lastDay: string): string {
  const shortDay = `${+postedDay.slice(5, 7)}/${+postedDay.slice(8, 10)}`;
  return postedDay.slice(0, 4) === lastDay.slice(0, 4)
    ? shortDay
    : `${postedDay.slice(0, 4)}/${shortDay}`;
}

/**
 * The two date fields → what the write carries. Both empty = no days named
 * (the server's default: today on 積む, the row's own on 直す); one filled =
 * that single day; both = the range. Never an inverted pair from here — the
 * fields bound each other (`min` / `max`), so the browser refuses one first.
 */
export function stackDaysInput(
  firstField: string,
  lastField: string,
): { firstDay?: string; lastDay?: string } {
  if (firstField === "" && lastField === "") return {};
  return { firstDay: firstField || lastField, lastDay: lastField || firstField };
}

/** What the feed orders by: (first_day, created_at, id) DESC — the server's page order (ADR-0005). */
export type FeedKey = { id: string; firstDay: string; createdAt: number };

/** True when `a` comes before `b` in the feed. */
const precedes = (a: FeedKey, b: FeedKey): boolean =>
  a.firstDay !== b.firstDay
    ? a.firstDay > b.firstDay
    : a.createdAt !== b.createdAt
      ? a.createdAt > b.createdAt
      : a.id > b.id;

/**
 * Put a 苔片 into the loaded page where the server would have put it — a 苔片
 * stacked on a past day sits on that day, not at the head. Beyond the last
 * loaded 苔片 it goes only when the page is the whole feed (`hasMore` false);
 * otherwise it belongs to a page もっと遡る has yet to fetch, and appending it
 * here would show it twice later. Pure: returns a new array.
 */
export function placeInFeed<T extends FeedKey>(posts: readonly T[], item: T, hasMore: boolean): T[] {
  const at = posts.findIndex((p) => precedes(item, p));
  if (at === -1) return hasMore ? [...posts] : [...posts, item];
  return [...posts.slice(0, at), item, ...posts.slice(at)];
}
