import { describe, expect, it } from "vitest";
import {
  APP_TZ,
  addDays,
  bucketSpansByDay,
  bucketSpansByMonth,
  dayKey,
  dayOfWeek,
  enumerateDays,
  enumerateMonths,
  isDayKey,
  monthOf,
  parseDayKey,
} from "./day";
import type { PostKind } from "./kind";

const HOUR = 3_600_000;

/** An instant, written as UTC wall-clock. Month is 1-based here, unlike `Date`. */
const utc = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, s, ms);

/** The instant a JST wall-clock reading names. JST is UTC+9 flat — no DST, ever. */
const jst = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) =>
  utc(y, mo, d, h, mi, s, ms) - 9 * HOUR;

describe("dayKey cuts the day in Asia/Tokyo", () => {
  it("00:00 JST opens the day; one ms earlier still belongs to the day before", () => {
    expect(dayKey(jst(2026, 8, 23))).toBe("2026-08-23");
    expect(dayKey(jst(2026, 8, 23) - 1)).toBe("2026-08-22");
  });

  it("08:59 JST is today — the UTC calendar still says yesterday", () => {
    // The bug this module exists to prevent: SQLite's date() would stack this
    // 苔片 on 2026-08-22, and the 総草 would light the wrong cell.
    const morning = jst(2026, 8, 23, 8, 59);
    expect(new Date(morning).toISOString()).toBe("2026-08-22T23:59:00.000Z");
    expect(dayKey(morning)).toBe("2026-08-23");
    expect(dayKey(morning, "UTC")).toBe("2026-08-22");
  });

  it("23:59:59.999 JST is still today; the next ms is tomorrow", () => {
    expect(dayKey(jst(2026, 8, 23, 23, 59, 59, 999))).toBe("2026-08-23");
    expect(dayKey(jst(2026, 8, 23, 23, 59, 59, 999) + 1)).toBe("2026-08-24");
  });

  it("crosses months and years on the JST boundary, not the UTC one", () => {
    expect(dayKey(jst(2026, 9, 1))).toBe("2026-09-01");
    expect(dayKey(jst(2026, 9, 1) - 1)).toBe("2026-08-31");
    expect(dayKey(jst(2027, 1, 1))).toBe("2027-01-01");
    // ...which is still 2026 in UTC.
    expect(dayKey(jst(2027, 1, 1), "UTC")).toBe("2026-12-31");
  });

  it("has a 29th of February in a leap year and not otherwise", () => {
    expect(dayKey(jst(2024, 2, 29, 12))).toBe("2024-02-29");
    expect(dayKey(jst(2024, 3, 1) - 1)).toBe("2024-02-29");
    expect(dayKey(jst(2025, 3, 1) - 1)).toBe("2025-02-28");
    // Century rule, both ways.
    expect(dayKey(jst(2000, 3, 1) - 1)).toBe("2000-02-29");
    expect(dayKey(jst(2100, 3, 1) - 1)).toBe("2100-02-28");
  });

  it("defaults to APP_TZ and honours any other zone, whole-hour or not", () => {
    const t = jst(2026, 8, 23, 8, 59);
    expect(dayKey(t)).toBe(dayKey(t, APP_TZ));
    expect(dayKey(t, "America/New_York")).toBe("2026-08-22"); // UTC-4 that day
    expect(dayKey(utc(2026, 8, 22, 18, 15), "Asia/Kathmandu")).toBe("2026-08-23"); // UTC+05:45
    expect(dayKey(utc(2026, 8, 22, 18, 14), "Asia/Kathmandu")).toBe("2026-08-22");
  });

  it("follows DST where a zone has it — the same UTC hour is a different local day", () => {
    const ny = "America/New_York";
    // 04:30Z is 00:30 EDT (summer) but 23:30 EST the evening before (winter).
    expect(dayKey(utc(2026, 7, 15, 4, 30), ny)).toBe("2026-07-15");
    expect(dayKey(utc(2026, 1, 15, 4, 30), ny)).toBe("2026-01-14");
  });

  it("handles the epoch and instants before it", () => {
    expect(dayKey(0)).toBe("1970-01-01"); // 09:00 JST
    expect(dayKey(-1)).toBe("1970-01-01"); // 08:59:59.999 JST
    expect(dayKey(0, "UTC")).toBe("1970-01-01");
    expect(dayKey(-1, "UTC")).toBe("1969-12-31");
  });

  it("throws rather than guess a neighbouring day", () => {
    expect(() => dayKey(Number.NaN)).toThrow(RangeError);
    expect(() => dayKey(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => dayKey(1.5)).toThrow(RangeError);
    expect(() => dayKey(8_640_000_000_000_001)).toThrow(RangeError);
    expect(() => dayKey(0, "Mars/Olympus_Mons")).toThrow(RangeError);
  });
});

describe("parseDayKey / isDayKey", () => {
  it("accepts days the calendar has", () => {
    expect(parseDayKey("2026-08-23")).toEqual({ year: 2026, month: 8, day: 23 });
    expect(parseDayKey("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseDayKey("2000-02-29")).toEqual({ year: 2000, month: 2, day: 29 });
    expect(isDayKey("2026-12-31")).toBe(true);
  });

  it("rejects days it does not — the rollover never becomes a silent shift", () => {
    expect(parseDayKey("2026-02-29")).toBeNull();
    expect(parseDayKey("2100-02-29")).toBeNull();
    expect(parseDayKey("2026-04-31")).toBeNull();
    expect(parseDayKey("2026-13-01")).toBeNull();
    expect(parseDayKey("2026-00-10")).toBeNull();
    expect(parseDayKey("2026-08-00")).toBeNull();
  });

  it("rejects anything that is not exactly YYYY-MM-DD", () => {
    for (const raw of ["", "2026-9-1", "26-09-01", "2026-09-01T00:00", " 2026-09-01", "2026/09/01"]) {
      expect(isDayKey(raw)).toBe(false);
    }
  });
});

describe("addDays walks the calendar", () => {
  it("crosses month, year and leap-day boundaries in both directions", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
    expect(addDays("2024-02-29", 365)).toBe("2025-02-28");
  });

  it("is exact over a year — 2024 is 366 days long", () => {
    expect(addDays("2024-01-01", 366)).toBe("2025-01-01");
    expect(addDays("2025-01-01", 365)).toBe("2026-01-01");
    expect(addDays("2026-08-23", 0)).toBe("2026-08-23");
  });

  it("rejects fractional deltas and malformed keys", () => {
    expect(() => addDays("2026-08-23", 0.5)).toThrow(RangeError);
    expect(() => addDays("2026-08-32", 1)).toThrow(RangeError);
  });
});

describe("dayOfWeek numbers the heatmap rows, Sunday = 0", () => {
  it("knows anchor dates across eras", () => {
    expect(dayOfWeek("2026-09-02")).toBe(3); // Wednesday
    expect(dayOfWeek("2026-08-30")).toBe(0); // Sunday
    expect(dayOfWeek("2026-09-05")).toBe(6); // Saturday
    expect(dayOfWeek("1970-01-01")).toBe(4); // the epoch was a Thursday
    expect(dayOfWeek("2000-02-29")).toBe(2); // leap century Tuesday
  });

  it("is consistent with addDays: one day forward is the next weekday", () => {
    expect(dayOfWeek(addDays("2026-08-30", 1))).toBe(1);
    expect(dayOfWeek(addDays("2026-09-05", 1))).toBe(0); // wraps to Sunday
    expect(dayOfWeek(addDays("2026-09-02", 7))).toBe(3); // a week is a no-op
  });

  it("rejects a malformed key", () => {
    expect(() => dayOfWeek("2026-9-2")).toThrow(RangeError);
  });
});

describe("enumerateDays lays out the grid", () => {
  it("is inclusive on both ends and ascending", () => {
    expect(enumerateDays("2026-08-23", "2026-08-23")).toEqual(["2026-08-23"]);
    expect(enumerateDays("2026-08-30", "2026-09-02")).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("counts a leap February as 29 days and a common one as 28", () => {
    expect(enumerateDays("2024-02-01", "2024-02-29")).toHaveLength(29);
    expect(enumerateDays("2025-02-01", "2025-02-28")).toHaveLength(28);
    expect(enumerateDays("2026-01-01", "2026-12-31")).toHaveLength(365);
  });

  it("treats an inverted range as an empty span, and refuses an absurd one", () => {
    expect(enumerateDays("2026-08-23", "2026-08-22")).toEqual([]);
    expect(() => enumerateDays("0001-01-01", "9999-12-31")).toThrow(RangeError);
  });
});

describe("monthOf cuts a day to its month", () => {
  it("is the key's first seven characters — the calendar is already the zone's", () => {
    expect(monthOf("2026-09-01")).toBe("2026-09");
    expect(monthOf("2026-12-31")).toBe("2026-12");
  });

  it("rejects a key that is not a day", () => {
    expect(() => monthOf("2026-09")).toThrow(RangeError);
    expect(() => monthOf("2026-02-30")).toThrow(RangeError);
  });
});

describe("enumerateMonths lists the months a span touches", () => {
  it("is inclusive on both ends and ascending, across a year end", () => {
    expect(enumerateMonths("2026-09-15", "2026-09-20")).toEqual(["2026-09"]);
    expect(enumerateMonths("2026-11-30", "2027-02-01")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("treats an inverted pair as empty, and refuses an absurd span", () => {
    expect(enumerateMonths("2026-09-02", "2026-08-31")).toEqual([]);
    expect(() => enumerateMonths("0001-01-01", "2026-09-06")).toThrow(RangeError);
  });

  it("rejects a malformed key", () => {
    expect(() => enumerateMonths("2026-09", "2026-10-01")).toThrow(RangeError);
  });
});

describe("bucketSpansByDay folds 苔片 onto the day axis", () => {
  const span = (firstDay: string, lastDay: string, kind: PostKind | null = null) => ({
    firstDay,
    lastDay,
    kind,
  });
  const tally = (count: number, input = 0, output = 0) => ({ count, input, output });

  it("counts nothing as nothing", () => {
    expect(bucketSpansByDay([], "2026-09-01", "2026-09-03")).toEqual(new Map());
  });

  it("a single-day 苔片 lights its one day; two on one day are two", () => {
    const tallies = bucketSpansByDay(
      [span("2026-08-23", "2026-08-23"), span("2026-08-23", "2026-08-23"), span("2026-08-25", "2026-08-25")],
      "2026-08-22",
      "2026-08-25",
    );
    expect(tallies).toEqual(
      new Map([
        ["2026-08-23", tally(2)],
        ["2026-08-25", tally(1)],
      ]),
    );
  });

  it("a 続く苔片 lights every day it was there, once each — one 片 on each day, not one 片 per day", () => {
    const tallies = bucketSpansByDay([span("2026-08-30", "2026-09-02")], "2026-08-01", "2026-09-30");
    expect([...tallies.keys()]).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
    for (const t of tallies.values()) expect(t).toEqual(tally(1));
  });

  it("clips to the window: the part outside costs nothing, and a span wholly outside is nothing", () => {
    const tallies = bucketSpansByDay(
      [
        span("2026-08-20", "2026-09-10"), // straddles both edges
        span("2026-07-01", "2026-08-31"), // ends on the first day of the window
        span("2026-09-03", "2026-09-30"), // starts after it
        span("2026-01-01", "2026-01-31"), // nowhere near
      ],
      "2026-08-31",
      "2026-09-02",
    );
    expect(tallies).toEqual(
      new Map([
        ["2026-08-31", tally(2)],
        ["2026-09-01", tally(1)],
        ["2026-09-02", tally(1)],
      ]),
    );
  });

  it("tallies the two sides of 向き: input and both are 吸う, output and both are 出す, 未分類 is neither", () => {
    const day = "2026-09-02";
    const tallies = bucketSpansByDay(
      [span(day, day, "input"), span(day, day, "output"), span(day, day, "both"), span(day, day, null)],
      day,
      day,
    );
    expect(tallies.get(day)).toEqual(tally(4, 2, 2));
  });

  it("throws on an inverted span or a malformed key instead of miscounting", () => {
    expect(() => bucketSpansByDay([span("2026-09-02", "2026-09-01")], "2026-09-01", "2026-09-02")).toThrow(
      RangeError,
    );
    expect(() => bucketSpansByDay([span("2026-9-2", "2026-09-02")], "2026-09-01", "2026-09-02")).toThrow(
      RangeError,
    );
    expect(() => bucketSpansByDay([], "2026-09-01", "2026-09-31")).toThrow(RangeError);
  });

  it("draws the heatmap: sparse tallies laid on a dense grid", () => {
    const tallies = bucketSpansByDay(
      [
        span("2026-08-22", "2026-08-22"),
        span("2026-08-23", "2026-08-23"),
        span("2026-08-23", "2026-08-23"),
        span("2026-08-25", "2026-08-25"),
      ],
      "2026-08-22",
      "2026-08-25",
    );
    const series = enumerateDays("2026-08-22", "2026-08-25").map((day) => ({
      day,
      count: tallies.get(day)?.count ?? 0,
    }));
    expect(series).toEqual([
      { day: "2026-08-22", count: 1 },
      { day: "2026-08-23", count: 2 }, // one 段 darker than its neighbours
      { day: "2026-08-24", count: 0 },
      { day: "2026-08-25", count: 1 },
    ]);
  });
});

describe("bucketSpansByMonth folds 苔片 onto the month axis", () => {
  const span = (firstDay: string, lastDay: string) => ({ firstDay, lastDay });

  it("counts per month, in ascending order of first appearance, and nothing for nothing", () => {
    expect(bucketSpansByMonth([])).toEqual(new Map());
    const counts = bucketSpansByMonth([
      span("2026-08-31", "2026-08-31"),
      span("2026-09-01", "2026-09-01"),
      span("2026-09-15", "2026-09-15"),
      span("2026-11-03", "2026-11-03"),
    ]);
    expect([...counts]).toEqual([
      ["2026-08", 1],
      ["2026-09", 2],
      ["2026-11", 1],
    ]);
  });

  it("a 続く苔片 across months counts once in each — the months add up to more than the 苔片", () => {
    const counts = bucketSpansByMonth([span("2026-08-30", "2026-10-02"), span("2026-09-10", "2026-09-10")]);
    expect([...counts]).toEqual([
      ["2026-08", 1],
      ["2026-09", 2],
      ["2026-10", 1],
    ]);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(2);
  });

  it("throws on an inverted span instead of miscounting", () => {
    expect(() => bucketSpansByMonth([span("2026-10-01", "2026-09-30")])).toThrow(RangeError);
  });
});
