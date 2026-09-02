import { describe, expect, it } from "vitest";
import {
  APP_TZ,
  addDays,
  bucketByDay,
  dayKey,
  dayStartMs,
  enumerateDays,
  isDayKey,
  parseDayKey,
} from "./day";

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
    // The bug this module exists to prevent: SQLite's date() would file this
    // 苔片 under 2026-08-22 and light the wrong cell.
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

describe("dayStartMs is the inverse of dayKey", () => {
  it("opens the JST day 9 hours before UTC midnight", () => {
    expect(dayStartMs("2026-08-23")).toBe(utc(2026, 8, 22, 15));
    expect(dayStartMs("2026-08-23", "UTC")).toBe(utc(2026, 8, 23));
    expect(dayStartMs("2026-08-23", "Asia/Kathmandu")).toBe(utc(2026, 8, 22, 18, 15));
  });

  it("round-trips every day across a month and a leap February", () => {
    for (const day of [...enumerateDays("2026-08-20", "2026-09-05"), ...enumerateDays("2024-02-26", "2024-03-02")]) {
      expect(dayKey(dayStartMs(day))).toBe(day);
      // The half-open window the heatmap query uses: [start, nextStart).
      expect(dayKey(dayStartMs(addDays(day, 1)) - 1)).toBe(day);
    }
  });

  it("follows DST where a zone has it — a 23-hour and a 25-hour day", () => {
    const ny = "America/New_York";
    const springForward = dayStartMs("2026-03-09", ny) - dayStartMs("2026-03-08", ny);
    const fallBack = dayStartMs("2026-11-02", ny) - dayStartMs("2026-11-01", ny);
    expect(springForward).toBe(23 * HOUR);
    expect(fallBack).toBe(25 * HOUR);
    expect(dayKey(dayStartMs("2026-03-08", ny), ny)).toBe("2026-03-08");
    expect(dayKey(dayStartMs("2026-11-01", ny), ny)).toBe("2026-11-01");
  });

  it("opens the day at the jump when a zone skips local midnight", () => {
    // Santiago goes 2026-09-05 24:00 -> 2026-09-06 01:00, so that day has no
    // 00:00 at all. The day still has to begin somewhere: at the transition.
    const scl = "America/Santiago";
    const start = dayStartMs("2026-09-06", scl);
    expect(start).toBe(utc(2026, 9, 6, 4)); // the jump itself: 01:00 local
    // It really is the day's first instant — one ms earlier is the day before,
    // and the day that lost the hour is 23 hours long.
    expect(dayKey(start, scl)).toBe("2026-09-06");
    expect(dayKey(start - 1, scl)).toBe("2026-09-05");
    expect(dayStartMs("2026-09-07", scl) - start).toBe(23 * HOUR);
  });

  it("throws on a key that is not a day", () => {
    expect(() => dayStartMs("2026-02-29")).toThrow(RangeError);
    expect(() => dayStartMs("today")).toThrow(RangeError);
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

describe("bucketByDay folds 苔片 onto the day axis", () => {
  it("counts nothing as nothing", () => {
    expect(bucketByDay([])).toEqual(new Map());
  });

  it("two 苔片 on different UTC days land on one JST cell", () => {
    const counts = bucketByDay([jst(2026, 8, 23, 8, 59), jst(2026, 8, 23, 23, 59)]);
    expect(counts).toEqual(new Map([["2026-08-23", 2]]));
  });

  it("two 苔片 on one UTC day land on different JST cells", () => {
    const evening = jst(2026, 8, 22, 23, 30); // 14:30 UTC on the 22nd
    const morning = jst(2026, 8, 23, 8, 30); // 23:30 UTC on the 22nd
    expect(new Date(evening).toISOString().slice(0, 10)).toBe(
      new Date(morning).toISOString().slice(0, 10),
    );
    expect(bucketByDay([evening, morning])).toEqual(
      new Map([
        ["2026-08-22", 1],
        ["2026-08-23", 1],
      ]),
    );
  });

  it("keeps the same 苔片 on the zone it is given", () => {
    const morning = [jst(2026, 8, 23, 8, 59)];
    expect(bucketByDay(morning)).toEqual(new Map([["2026-08-23", 1]]));
    expect(bucketByDay(morning, "UTC")).toEqual(new Map([["2026-08-22", 1]]));
  });

  it("throws on a broken timestamp instead of miscounting", () => {
    expect(() => bucketByDay([jst(2026, 8, 23), Number.NaN])).toThrow(RangeError);
  });

  it("draws the heatmap: sparse counts laid on a dense grid", () => {
    const counts = bucketByDay([
      jst(2026, 8, 22, 23, 10),
      jst(2026, 8, 23, 8, 59),
      jst(2026, 8, 23, 23, 59),
      jst(2026, 8, 25, 0, 0),
    ]);
    const series = enumerateDays("2026-08-22", "2026-08-25").map((day) => ({
      day,
      count: counts.get(day) ?? 0,
    }));
    expect(series).toEqual([
      { day: "2026-08-22", count: 1 },
      { day: "2026-08-23", count: 2 }, // one 段 darker than its neighbours
      { day: "2026-08-24", count: 0 },
      { day: "2026-08-25", count: 1 },
    ]);
  });
});
