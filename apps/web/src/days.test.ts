import { describe, expect, it } from "vitest";
import {
  daysLabel,
  earliestStackDay,
  isStackedNow,
  placeInFeed,
  postedLabel,
  stackDaysInput,
} from "./days";

describe("earliestStackDay — the fields' min, the Worker's 1200-month floor spelled here", () => {
  it("is the 1st of the month 1200 months back, today's month counted (worker/core/day.test.ts agrees)", () => {
    expect(earliestStackDay("2026-09-06")).toBe("1926-10-01");
    expect(earliestStackDay("2026-01-01")).toBe("1926-02-01");
    expect(earliestStackDay("2026-12-31")).toBe("1927-01-01");
  });
});

describe("isStackedNow — written on its one day", () => {
  it("is true only when all three days agree", () => {
    expect(isStackedNow({ firstDay: "2026-09-06", lastDay: "2026-09-06", postedDay: "2026-09-06" })).toBe(true);
    expect(isStackedNow({ firstDay: "2026-09-05", lastDay: "2026-09-05", postedDay: "2026-09-06" })).toBe(false);
    expect(isStackedNow({ firstDay: "2026-09-05", lastDay: "2026-09-06", postedDay: "2026-09-06" })).toBe(false);
  });
});

describe("daysLabel / postedLabel — the card's words for a 苔片 not stacked now", () => {
  it("names a day, or a range with 〜", () => {
    expect(daysLabel("2025-03-01", "2025-03-01")).toBe("2025/03/01");
    expect(daysLabel("2025-03-01", "2026-01-31")).toBe("2025/03/01 〜 2026/01/31");
  });

  it("shortens the posted day to M/D while the year is the last day's, and spells the year otherwise", () => {
    expect(postedLabel("2026-09-06", "2026-09-05")).toBe("9/6");
    expect(postedLabel("2026-12-31", "2026-01-31")).toBe("12/31");
    expect(postedLabel("2026-01-05", "2025-12-31")).toBe("2026/1/5");
  });
});

describe("stackDaysInput — two fields, one wire shape, the 厚み riding along", () => {
  it("names no days when both are empty — and so no 厚み either", () => {
    expect(stackDaysInput("", "")).toEqual({});
    expect(stackDaysInput("", "", 60)).toEqual({});
  });

  it("makes one filled field a single day, whichever it is, with no 厚み (null)", () => {
    const single = { firstDay: "2026-09-05", lastDay: "2026-09-05", thickness: null };
    expect(stackDaysInput("2026-09-05", "")).toEqual(single);
    expect(stackDaysInput("", "2026-09-05")).toEqual(single);
    expect(stackDaysInput("2026-09-05", "2026-09-05")).toEqual(single);
  });

  it("sends a range with the 苔片's own 厚み, or 毎日 (100) for one that has none yet", () => {
    expect(stackDaysInput("2026-09-05", "2026-09-06")).toEqual({
      firstDay: "2026-09-05",
      lastDay: "2026-09-06",
      thickness: 100,
    });
    expect(stackDaysInput("2026-09-05", "2026-09-06", null)).toEqual({
      firstDay: "2026-09-05",
      lastDay: "2026-09-06",
      thickness: 100,
    });
    expect(stackDaysInput("2026-09-05", "2026-09-06", 60)).toEqual({
      firstDay: "2026-09-05",
      lastDay: "2026-09-06",
      thickness: 60,
    });
  });

  it("drops the 厚み when a 続く苔片 is shortened to one day", () => {
    expect(stackDaysInput("2026-09-06", "2026-09-06", 60)).toEqual({
      firstDay: "2026-09-06",
      lastDay: "2026-09-06",
      thickness: null,
    });
  });
});

describe("placeInFeed — the server's order, kept on the client", () => {
  const p = (id: string, firstDay: string, createdAt: number) => ({ id, firstDay, createdAt });
  const page = [p("c", "2026-09-06", 300), p("b", "2026-09-06", 200), p("a", "2026-09-04", 100)];

  it("puts a 苔片 stacked now at the head", () => {
    expect(placeInFeed(page, p("d", "2026-09-06", 400), true).map((x) => x.id)).toEqual([
      "d",
      "c",
      "b",
      "a",
    ]);
  });

  it("puts a past day where that day sits — after today's, before older days", () => {
    expect(placeInFeed(page, p("d", "2026-09-05", 400), true).map((x) => x.id)).toEqual([
      "c",
      "b",
      "d",
      "a",
    ]);
  });

  it("orders within a day by the moment written, then by id", () => {
    expect(placeInFeed(page, p("d", "2026-09-06", 250), true).map((x) => x.id)).toEqual([
      "c",
      "d",
      "b",
      "a",
    ]);
    expect(placeInFeed(page, p("bb", "2026-09-06", 200), true).map((x) => x.id)).toEqual([
      "c",
      "bb",
      "b",
      "a",
    ]);
    expect(placeInFeed(page, p("aa", "2026-09-06", 200), true).map((x) => x.id)).toEqual([
      "c",
      "b",
      "aa",
      "a",
    ]);
  });

  it("appends beyond the last loaded 苔片 only when the page is the whole feed", () => {
    const older = p("z", "2026-09-01", 400);
    expect(placeInFeed(page, older, false).map((x) => x.id)).toEqual(["c", "b", "a", "z"]);
    expect(placeInFeed(page, older, true).map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(placeInFeed([], older, false).map((x) => x.id)).toEqual(["z"]);
  });

  it("leaves the given array alone", () => {
    const before = page.map((x) => x.id);
    placeInFeed(page, p("d", "2026-09-05", 400), true);
    expect(page.map((x) => x.id)).toEqual(before);
  });
});
