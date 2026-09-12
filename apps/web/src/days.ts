// The days a 苔片 stacks on, browser side — the mirror of worker/core/day.ts's
// write-side rules (the SPA must not import Worker modules, so the little that
// the composer and the cards need is spelled once more here). A 苔片 carries
// `firstDay` / `lastDay` (the 「日」 it was there, ADR-0005) and `postedDay`
// (the day it was written on); all three are the server's `YYYY-MM-DD` keys and
// this module only compares and formats them — no clock, no zone.

import { formatAmount } from "./amount";
import { slashDay } from "./period";

/**
 * How far back a 苔片 may be stacked: 1200 months, today's month included — the
 * same ceiling as the Worker's month walk (worker/core/day.ts MAX_SPAN_MONTHS),
 * which is why the number is here at all. The route is the check that counts;
 * this is the date fields' `min`, so the browser says no before the server has to.
 */
const STACK_MONTHS = 1200;

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** The shape of a day key as the date fields spell it — "" (not chosen) is not one. */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

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
 * How many calendar days `from`..`to` holds, both inclusive — the mirror of
 * worker/core/day.ts countDays on the same UTC carrier: 1 for a single day,
 * 0 for an inverted pair or a key that is not a day. The 換算 under the 厚み
 * slider is this × 厚み (ADR-0007: 量 = 日数 × 厚み).
 */
export function countDays(from: string, to: string): number {
  if (!DAY_KEY.test(from) || !DAY_KEY.test(to)) return 0;
  const ms = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
  const days = (ms(to) - ms(from)) / 86_400_000 + 1;
  return days >= 1 ? days : 0;
}

/**
 * The date fields and the 厚み slider as the composer and the edit form hold
 * them: `YYYY-MM-DD` the way the fields spell it, "" = not chosen; `thickness`
 * the slider's position, a whole 1..100, kept even while no range shows it.
 */
export type DaysFields = { firstDay: string; lastDay: string; thickness: number };

/** 毎日 — where the 厚み slider starts (ADR-0007: 100% is a sheet every day), and what an old draft reads as. */
export const EVERY_DAY = 100;

/**
 * The slider's 目盛り (features.md §1): the 厚み a rhythm usually comes to —
 * 週 1 = 1/7, 仕事 = 月 20 営業日 ≒ 60, 平日 = 5/7, 毎日. Ascending, 毎日 last.
 */
export const THICKNESS_TICKS: readonly { value: number; label: string }[] = [
  { value: 14, label: "週 1" },
  { value: 60, label: "仕事" },
  { value: 71, label: "平日" },
  { value: EVERY_DAY, label: "毎日" },
];

/**
 * Whether the two fields make a 続く苔片: both chosen and いつ before 〜いつまで
 * (day keys order as strings). One field, equal days, or an inverted pair — the
 * browser's own rangeOverflow, never submitted — is not a range: no slider, no 厚み.
 */
export const isRange = (firstDay: string, lastDay: string): boolean =>
  firstDay !== "" && lastDay !== "" && firstDay < lastDay;

/** 「厚み 60%」 — a 続く苔片's declared 厚み, on its card and in the edit form's folded summary. */
export const thicknessLabel = (thickness: number): string => `厚み ${thickness}%`;

/**
 * The slider's 換算 — 「60% · 731 日のうち 439 日分」: the days of the range and
 * the 量 they would come to at this 厚み (731 × 60% = 438.6, shown as the
 * charts show 量: whole from 1 up, one decimal below). Follows the fields, so
 * lengthening the range moves the second number.
 */
export function thicknessNote(thickness: number, firstDay: string, lastDay: string): string {
  const days = countDays(firstDay, lastDay);
  return `${thickness}% · ${days} 日のうち ${formatAmount((days * thickness) / 100)} 日分`;
}

/**
 * The fields → what the write carries. Both days empty = no days named (the
 * server's default: today on 積む, the row's own on 直す) and so no 厚み; one
 * filled = that single day; both = the range. Never an inverted pair from here
 * — the fields bound each other (`min` / `max`), so the browser refuses one first.
 *
 * The 厚み rides with the days (ADR-0007): a range sends the slider's value
 * and a single day sends null — what shortening a 続く苔片 to one day needs,
 * and harmless on a day that never had one. The slider's position is kept
 * while a single day hides it; it only reaches the wire with a range.
 */
export function stackingInput(
  fields: DaysFields,
): { firstDay?: string; lastDay?: string; thickness?: number | null } {
  if (fields.firstDay === "" && fields.lastDay === "") return {};
  const firstDay = fields.firstDay || fields.lastDay;
  const lastDay = fields.lastDay || fields.firstDay;
  return { firstDay, lastDay, thickness: firstDay === lastDay ? null : fields.thickness };
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
