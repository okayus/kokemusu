// 期間で絞る (docs/features.md §3): 日・週・月・年 and a custom range are ONE
// shape — an inclusive range of JST days, `from` / `to` as `YYYY-MM-DD` keys,
// either half optional (`from` alone = それ以降, `to` alone = それ以前). The
// presets only pick a calendar unit around "today", and today comes from the
// server, which owns the zone (posts-api `Timeline.today`); nothing here
// touches a clock or a time zone. Civil math rides the UTC carrier, the same
// trick as the 総草 and the 年表 (worker/core/day.ts explains why it is safe).

export type Period = { from?: string; to?: string };

export type PresetKind = "today" | "week" | "month" | "year";

/** The four one-tap units, in the order the form shows them. */
export const PRESETS: readonly { kind: PresetKind; label: string }[] = [
  { kind: "today", label: "今日" },
  { kind: "week", label: "今週" },
  { kind: "month", label: "今月" },
  { kind: "year", label: "今年" },
];

const MS_PER_DAY = 86_400_000;

const year = (day: string) => +day.slice(0, 4);
const month = (day: string) => +day.slice(5, 7);

/** Midnight of a `YYYY-MM-DD` key read as if it were UTC — the carrier for calendar math. */
const civilMs = (day: string) => Date.UTC(year(day), month(day) - 1, +day.slice(8, 10));

const pad = (n: number, width: number) => String(n).padStart(width, "0");

const keyOf = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
};

/** Last day of the month `day` is in: day 0 of the next month, by `Date.UTC`'s rollover. */
const monthEnd = (day: string) => keyOf(Date.UTC(year(day), month(day), 0));

/**
 * The whole calendar unit around `today`: the day itself, its Sunday-start
 * week (the 総草's columns), its month, its year. Whole units rather than
 * "up to today" so the chip reads as the unit ("2026年9月") and a 苔片 stacked
 * after midnight still falls inside a range picked the evening before.
 */
export function presetPeriod(kind: PresetKind, today: string): { from: string; to: string } {
  switch (kind) {
    case "today":
      return { from: today, to: today };
    case "week": {
      const ms = civilMs(today);
      const sunday = ms - new Date(ms).getUTCDay() * MS_PER_DAY;
      return { from: keyOf(sunday), to: keyOf(sunday + 6 * MS_PER_DAY) };
    }
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: monthEnd(today) };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  }
}

/** The two date fields as a period, or null when both are empty (= no period). */
export function periodFromFields(from: string, to: string): Period | null {
  if (from === "" && to === "") return null;
  return { ...(from === "" ? {} : { from }), ...(to === "" ? {} : { to }) };
}

/** Identity of a period for change detection and keys; "" for none. */
export const periodKey = (period: Period | null): string =>
  period === null ? "" : `${period.from ?? ""}~${period.to ?? ""}`;

/** `YYYY-MM-DD` → `YYYY/MM/DD`, the spelling the 苔片 timestamps use (ja-JP). */
const slash = (day: string) => day.replaceAll("-", "/");

/**
 * The chip's text. A whole year or a whole month is named as the unit, a
 * single day as the day, anything else as the range or its open half.
 */
export function periodLabel(period: Period): string {
  const { from, to } = period;
  if (from !== undefined && to !== undefined) {
    if (from === to) return slash(from);
    if (from === `${year(from)}-01-01` && to === `${year(from)}-12-31`) return `${year(from)}年`;
    if (from === `${from.slice(0, 7)}-01` && to === monthEnd(from)) {
      return `${year(from)}年${month(from)}月`;
    }
    return `${slash(from)} 〜 ${slash(to)}`;
  }
  if (from !== undefined) return `${slash(from)} 以降`;
  if (to !== undefined) return `${slash(to)} 以前`;
  return "";
}

/** Whether a 苔片 stacked on `day` (its server-decided JST day) falls inside the period. */
export function dayInPeriod(day: string, period: Period | null): boolean {
  if (period === null) return true;
  return (period.from === undefined || period.from <= day) && (period.to === undefined || day <= period.to);
}
