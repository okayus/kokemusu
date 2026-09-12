import { describe, expect, it } from "vitest";
import {
  amountByMonth,
  amountOf,
  daySpanOf,
  decodeStacking,
  encodeStacking,
  measuredThickness,
  parseStacking,
  patchStacking,
  spanDays,
  thicknessSchema,
  totalAmount,
  type Stacking,
  type StackingRow,
} from "./stacking";

const TODAY = "2026-09-06";
const th = (n: number) => thicknessSchema.parse(n);
const day = (d: string): Stacking => ({ on: "day", day: d });
const days = (firstDay: string, lastDay: string, thickness: number): Stacking => ({
  on: "days",
  firstDay,
  lastDay,
  thickness: th(thickness),
});

describe("thicknessSchema — the one constructor of a 厚み: a whole percentage 1..100", () => {
  it("takes 1, 60 and 100", () => {
    for (const n of [1, 14, 60, 71, 100]) expect(thicknessSchema.safeParse(n).success).toBe(true);
    expect(th(60)).toBe(60);
  });

  it("refuses 0, 101, a fraction, a string, null and NaN", () => {
    for (const bad of [0, 101, -1, 60.5, "60", null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(thicknessSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });
});

describe("parseStacking — the wire read as a Stacking, or null", () => {
  it("names today when the body names no day, and a single day when it names one", () => {
    expect(parseStacking({}, TODAY)).toEqual(day(TODAY));
    expect(parseStacking({ firstDay: "2026-09-05" }, TODAY)).toEqual(day("2026-09-05"));
    expect(parseStacking({ firstDay: "2026-09-05", lastDay: "2026-09-05" }, TODAY)).toEqual(
      day("2026-09-05"),
    );
    // `lastDay` alone pairs with today as `firstDay` — the same day works, an earlier one inverts.
    expect(parseStacking({ lastDay: TODAY }, TODAY)).toEqual(day(TODAY));
    expect(parseStacking({ lastDay: "2026-09-05" }, TODAY)).toBeNull();
  });

  it("a single day has no 厚み: null or nothing is fine, a number is not", () => {
    expect(parseStacking({ firstDay: "2026-09-05", thickness: null }, TODAY)).toEqual(day("2026-09-05"));
    expect(parseStacking({ firstDay: "2026-09-05", thickness: undefined }, TODAY)).toEqual(
      day("2026-09-05"),
    );
    expect(parseStacking({ firstDay: "2026-09-05", thickness: 60 }, TODAY)).toBeNull();
    expect(parseStacking({ firstDay: "2026-09-05", thickness: 100 }, TODAY)).toBeNull();
    expect(parseStacking({ thickness: 100 }, TODAY)).toBeNull();
  });

  it("a range needs its 厚み: nothing and null are null, a Thickness makes a 続く苔片", () => {
    const range = { firstDay: "2025-03-01", lastDay: "2026-01-31" };
    expect(parseStacking(range, TODAY)).toBeNull();
    expect(parseStacking({ ...range, thickness: null }, TODAY)).toBeNull();
    expect(parseStacking({ ...range, thickness: 60 }, TODAY)).toEqual(days("2025-03-01", "2026-01-31", 60));
    expect(parseStacking({ ...range, thickness: 100 }, TODAY)).toEqual(days("2025-03-01", "2026-01-31", 100));
    expect(parseStacking({ ...range, thickness: 1 }, TODAY)).toEqual(days("2025-03-01", "2026-01-31", 1));
  });

  it("a range with a number that is not a Thickness is null, not a clamp", () => {
    const range = { firstDay: "2025-03-01", lastDay: "2026-01-31" };
    for (const bad of [0, 101, 60.5, -5, Number.NaN]) {
      expect(parseStacking({ ...range, thickness: bad }, TODAY), String(bad)).toBeNull();
    }
  });

  // The table canStackOn used to carry (first ≤ last ≤ today, the floor), now
  // read by the same function that reads the 厚み.
  it("takes a range ending today or earlier, and one reaching back to the floor", () => {
    expect(parseStacking({ firstDay: "2026-09-05", lastDay: TODAY, thickness: 100 }, TODAY)).toEqual(
      days("2026-09-05", TODAY, 100),
    );
    expect(parseStacking({ firstDay: "1926-10-01", lastDay: TODAY, thickness: 14 }, TODAY)).toEqual(
      days("1926-10-01", TODAY, 14),
    );
  });

  it("refuses a day that has not come — the last day may not pass today", () => {
    expect(parseStacking({ firstDay: "2026-09-07" }, TODAY)).toBeNull();
    expect(parseStacking({ firstDay: TODAY, lastDay: "2026-09-07", thickness: 100 }, TODAY)).toBeNull();
  });

  it("refuses an inverted pair, 厚み or not", () => {
    expect(parseStacking({ firstDay: TODAY, lastDay: "2026-09-05" }, TODAY)).toBeNull();
    expect(parseStacking({ firstDay: TODAY, lastDay: "2026-09-05", thickness: 100 }, TODAY)).toBeNull();
  });

  it("refuses a first day below the floor, by one day, and moves with today", () => {
    expect(parseStacking({ firstDay: "1926-09-30" }, TODAY)).toBeNull();
    expect(parseStacking({ firstDay: "1926-09-30", lastDay: TODAY, thickness: 100 }, TODAY)).toBeNull();
    expect(parseStacking({ firstDay: "0001-01-01" }, TODAY)).toBeNull();
    expect(parseStacking({ firstDay: "1926-10-01" }, TODAY)).toEqual(day("1926-10-01"));
    expect(parseStacking({ firstDay: "1926-10-01" }, "2026-10-01")).toBeNull();
  });

  it("refuses anything that is not a calendar day, today included, without throwing", () => {
    expect(parseStacking({ firstDay: "2026-02-30" }, TODAY)).toBeNull();
    expect(parseStacking({ firstDay: "2026-9-6" }, TODAY)).toBeNull();
    expect(parseStacking({ firstDay: "2026-09-05", lastDay: "yesterday", thickness: 100 }, TODAY)).toBeNull();
    expect(parseStacking({ firstDay: "" }, TODAY)).toBeNull();
    expect(parseStacking({}, "today")).toBeNull();
    expect(parseStacking({}, "")).toBeNull();
  });
});

describe("patchStacking — an edit names only what it changes; the 厚み is three-valued", () => {
  const single = day("2026-09-05");
  const span = days("2026-09-01", "2026-09-05", 60);

  it("changes nothing when the patch says nothing — days and 厚み alike", () => {
    expect(patchStacking(single, {}, TODAY)).toEqual(single);
    expect(patchStacking(span, {}, TODAY)).toEqual(span);
    expect(patchStacking(span, { thickness: undefined }, TODAY)).toEqual(span);
  });

  it("lengthens a 続く苔片 by lastDay alone, its 厚み intact", () => {
    expect(patchStacking(span, { lastDay: TODAY }, TODAY)).toEqual(days("2026-09-01", TODAY, 60));
  });

  it("refuses to lengthen a single day into a range without a 厚み, and takes one with it", () => {
    expect(patchStacking(single, { lastDay: TODAY }, TODAY)).toBeNull();
    expect(patchStacking(single, { lastDay: TODAY, thickness: null }, TODAY)).toBeNull();
    expect(patchStacking(single, { lastDay: TODAY, thickness: 100 }, TODAY)).toEqual(
      days("2026-09-05", TODAY, 100),
    );
  });

  it("refuses to shorten a range to one day while its 厚み stays, and takes null with it", () => {
    const shrink = { firstDay: "2026-09-05", lastDay: "2026-09-05" };
    expect(patchStacking(span, shrink, TODAY)).toBeNull();
    expect(patchStacking(span, { ...shrink, thickness: 60 }, TODAY)).toBeNull();
    expect(patchStacking(span, { ...shrink, thickness: null }, TODAY)).toEqual(day("2026-09-05"));
    // The same shortening with one field: firstDay moved up to lastDay.
    expect(patchStacking(span, { firstDay: "2026-09-05", thickness: null }, TODAY)).toEqual(
      day("2026-09-05"),
    );
  });

  it("replaces the 厚み of a range with a number, and refuses null on a range or a number on a day", () => {
    expect(patchStacking(span, { thickness: 30 }, TODAY)).toEqual(days("2026-09-01", "2026-09-05", 30));
    expect(patchStacking(span, { thickness: null }, TODAY)).toBeNull();
    expect(patchStacking(single, { thickness: 60 }, TODAY)).toBeNull();
    expect(patchStacking(span, { thickness: 0 }, TODAY)).toBeNull();
  });

  it("holds the result to the same rule as a new 苔片", () => {
    expect(patchStacking(span, { lastDay: "2026-09-07" }, TODAY)).toBeNull();
    expect(patchStacking(single, { firstDay: TODAY, lastDay: "2026-09-05", thickness: 100 }, TODAY)).toBeNull();
  });
});

describe("decodeStacking — a row the CHECKs promised, or a throw", () => {
  it("reads a single day (NULL) and a range (its 厚み)", () => {
    expect(decodeStacking({ firstDay: "2026-09-05", lastDay: "2026-09-05", thickness: null })).toEqual(
      day("2026-09-05"),
    );
    expect(decodeStacking({ firstDay: "2025-03-01", lastDay: "2026-01-31", thickness: 100 })).toEqual(
      days("2025-03-01", "2026-01-31", 100),
    );
  });

  it("throws on a single day with a 厚み, a range without one or outside 1..100, an inverted range, a non-day", () => {
    const broken: StackingRow[] = [
      { firstDay: "2026-09-05", lastDay: "2026-09-05", thickness: 60 },
      { firstDay: "2025-03-01", lastDay: "2026-01-31", thickness: null },
      { firstDay: "2025-03-01", lastDay: "2026-01-31", thickness: 250 },
      { firstDay: "2025-03-01", lastDay: "2026-01-31", thickness: 0 },
      { firstDay: "2025-03-01", lastDay: "2026-01-31", thickness: 60.5 },
      { firstDay: "2026-01-31", lastDay: "2025-03-01", thickness: 100 },
      { firstDay: "2026-02-30", lastDay: "2026-02-30", thickness: null },
      { firstDay: "2026-9-5", lastDay: "2026-09-05", thickness: null },
    ];
    for (const row of broken) {
      expect(() => decodeStacking(row), JSON.stringify(row)).toThrow(RangeError);
    }
  });
});

describe("encodeStacking — the one place NULL is born; decode ∘ encode = id = encode ∘ decode", () => {
  it("writes a single day as NULL and a range with its 厚み", () => {
    expect(encodeStacking(day("2026-09-05"))).toEqual({
      firstDay: "2026-09-05",
      lastDay: "2026-09-05",
      thickness: null,
    });
    expect(encodeStacking(days("2025-03-01", "2026-01-31", 60))).toEqual({
      firstDay: "2025-03-01",
      lastDay: "2026-01-31",
      thickness: 60,
    });
  });

  it("round-trips both ways", () => {
    const stackings = [day(TODAY), day("1926-10-01"), days("2026-09-05", TODAY, 1), days("2022-04-01", "2024-03-31", 60)];
    for (const s of stackings) expect(decodeStacking(encodeStacking(s))).toEqual(s);
    const rows: StackingRow[] = [
      { firstDay: "2026-09-05", lastDay: "2026-09-05", thickness: null },
      { firstDay: "2022-04-01", lastDay: "2024-03-31", thickness: 60 },
    ];
    for (const r of rows) expect(encodeStacking(decodeStacking(r))).toEqual(r);
  });

  it("agrees with parseStacking: what the wire carries in, the row carries back out", () => {
    const wire = { firstDay: "2025-03-01", lastDay: "2026-01-31", thickness: 60 };
    const parsed = parseStacking(wire, TODAY);
    expect(parsed).not.toBeNull();
    if (parsed) expect(encodeStacking(parsed)).toEqual(wire);
  });
});

describe("daySpanOf / spanDays — the days without the 量", () => {
  it("hands the 総草 and the 年表 just the days", () => {
    expect(daySpanOf(day("2026-09-05"))).toEqual({ firstDay: "2026-09-05", lastDay: "2026-09-05" });
    expect(daySpanOf(days("2025-03-01", "2026-01-31", 60))).toEqual({
      firstDay: "2025-03-01",
      lastDay: "2026-01-31",
    });
  });

  it("counts calendar days, 1 for a single day", () => {
    expect(spanDays(day("2026-09-05"))).toBe(1);
    expect(spanDays(days("2026-09-05", TODAY, 100))).toBe(2);
    expect(spanDays(days("2022-04-01", "2024-03-31", 60))).toBe(731);
  });
});

describe("amountOf — 量 = days × 厚み, clipped to a window", () => {
  it("a single day is 1; n days at 100% are n — the same as n single days", () => {
    expect(amountOf(day("2026-09-05"))).toBe(1);
    expect(amountOf(days("2026-09-05", TODAY, 100))).toBe(2);
    expect(amountOf(days("2026-08-28", TODAY, 100))).toBe(10);
  });

  it("731 days at 60% are 438.6 — a fraction, not rounded here", () => {
    expect(amountOf(days("2022-04-01", "2024-03-31", 60))).toBe(438.6);
    expect(amountOf(days("2026-08-28", TODAY, 1))).toBe(0.1);
  });

  it("a window that covers the 苔片 changes nothing; one it never touches gives 0", () => {
    const s = days("2022-04-01", "2024-03-31", 60);
    expect(amountOf(s, { from: "2022-04-01", to: "2024-03-31" })).toBe(438.6);
    expect(amountOf(s, { from: "2000-01-01", to: "2026-09-06" })).toBe(438.6);
    expect(amountOf(s, { from: "2024-04-01", to: "2026-09-06" })).toBe(0);
    expect(amountOf(s, { from: "2000-01-01", to: "2022-03-31" })).toBe(0);
    expect(amountOf(day("2026-09-05"), { from: "2026-09-01", to: TODAY })).toBe(1);
    expect(amountOf(day("2026-09-05"), { from: "2026-09-05", to: "2026-09-05" })).toBe(1);
    expect(amountOf(day("2026-09-05"), { from: TODAY, to: TODAY })).toBe(0);
  });

  it("a window over part of a 続く苔片 counts the overlapping days only", () => {
    const s = days("2026-01-01", "2026-01-31", 50);
    // 16 days overlap (1/16 .. 1/31) at 50%.
    expect(amountOf(s, { from: "2026-01-16", to: "2026-02-15" })).toBe(8);
    // 2026 (this year) of the 2022–2024 案件: none. 2024 alone: Jan 1 .. Mar 31 = 91 days × 0.6.
    expect(amountOf(days("2022-04-01", "2024-03-31", 60), { from: "2024-01-01", to: "2024-12-31" })).toBe(54.6);
  });
});

describe("totalAmount — several 苔片's 量 together, the same window on each", () => {
  it("is 0 for none, n for n single days, and the sum of 続く苔片 at their 厚み", () => {
    expect(totalAmount([])).toBe(0);
    expect(totalAmount([day("2026-09-01"), day("2026-09-01"), day("2026-09-05")])).toBe(3);
    expect(totalAmount([day("2026-09-05"), days("2022-04-01", "2024-03-31", 60)])).toBe(439.6);
  });

  it("clips every 苔片 to the window — a day outside it and a 続く苔片 it never touches weigh 0", () => {
    const stackings = [day("2026-08-31"), day("2026-09-05"), days("2026-08-28", TODAY, 50)];
    // The 続く苔片 has 6 of its 10 days in September.
    expect(totalAmount(stackings, { from: "2026-09-01", to: TODAY })).toBe(4);
    expect(totalAmount(stackings, { from: "2026-01-01", to: TODAY })).toBe(7);
    expect(totalAmount(stackings, { from: "2026-09-07", to: "2026-09-30" })).toBe(0);
  });
});

describe("amountByMonth — the 量 per 活動月, the months partitioning the days", () => {
  it("puts a single day's 1 in its month, several in the same month adding up", () => {
    expect(amountByMonth([day("2026-09-05")])).toEqual(new Map([["2026-09", 1]]));
    expect(amountByMonth([day("2026-09-05"), day("2026-09-01"), day("2026-08-31")])).toEqual(
      new Map([
        ["2026-09", 2],
        ["2026-08", 1],
      ]),
    );
  });

  it("gives a 続く苔片 each month's own days × 厚み — the months then add up to its 量", () => {
    // Aug 28–31 = 4 days, Sep 1–6 = 6 days, at 50%.
    expect(amountByMonth([days("2026-08-28", TODAY, 50)])).toEqual(
      new Map([
        ["2026-08", 2],
        ["2026-09", 3],
      ]),
    );
    // 2022-04 .. 2024-03 at 60%: 24 months, each its calendar days × 0.6 (April 18, February 2024 17.4).
    const byMonth = amountByMonth([days("2022-04-01", "2024-03-31", 60)]);
    expect(byMonth.size).toBe(24);
    expect(byMonth.get("2022-04")).toBe(18);
    expect(byMonth.get("2024-02")).toBeCloseTo(17.4, 12);
    let sum = 0;
    for (const v of byMonth.values()) sum += v;
    expect(sum).toBeCloseTo(438.6, 9);
  });

  it("stacks 苔片 of both kinds in one month, sparse over the months none touched", () => {
    const byMonth = amountByMonth([day("2026-09-05"), days("2026-06-30", "2026-07-01", 100), day("2026-09-01")]);
    expect([...byMonth].sort()).toEqual([
      ["2026-06", 1],
      ["2026-07", 1],
      ["2026-09", 2],
    ]);
    expect(byMonth.has("2026-08")).toBe(false);
  });

  it("is empty for none", () => {
    expect(amountByMonth([])).toEqual(new Map());
  });
});

describe("measuredThickness — 量 ÷ days, a ratio that may pass 1", () => {
  it("recovers the declared 厚み of one 続く苔片, and goes past 1 when a day holds several 苔片", () => {
    expect(measuredThickness(438.6, 731)).toBeCloseTo(0.6, 12);
    expect(measuredThickness(10, 10)).toBe(1);
    expect(measuredThickness(3, 1)).toBe(3);
    expect(measuredThickness(0, 0)).toBe(0);
  });
});
