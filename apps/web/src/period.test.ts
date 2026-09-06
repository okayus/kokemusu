import { describe, expect, it } from "vitest";
import {
  periodFromFields,
  periodKey,
  periodLabel,
  presetPeriod,
  spanInPeriod,
  type Period,
} from "./period";

// Pure civil math on day keys — "today" is whatever the server said, so every
// case here is a fixed string. 2026-09-05 is a Saturday.

describe("presetPeriod — the whole calendar unit around today", () => {
  it("today is the one day", () => {
    expect(presetPeriod("today", "2026-09-05")).toEqual({ from: "2026-09-05", to: "2026-09-05" });
  });

  it("week runs Sunday to Saturday, like the 総草's columns", () => {
    expect(presetPeriod("week", "2026-09-05")).toEqual({ from: "2026-08-30", to: "2026-09-05" });
    // A Sunday opens its own week; a Wednesday sits mid-week.
    expect(presetPeriod("week", "2026-08-30")).toEqual({ from: "2026-08-30", to: "2026-09-05" });
    expect(presetPeriod("week", "2026-09-02")).toEqual({ from: "2026-08-30", to: "2026-09-05" });
  });

  it("week crosses a year boundary on the calendar, not on the year", () => {
    // 2027-01-01 is a Friday: its week opened on Sunday 2026-12-27.
    expect(presetPeriod("week", "2027-01-01")).toEqual({ from: "2026-12-27", to: "2027-01-02" });
  });

  it("month runs 1st to last day, leap February included", () => {
    expect(presetPeriod("month", "2026-09-05")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetPeriod("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(presetPeriod("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetPeriod("month", "2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("year runs Jan 1 to Dec 31", () => {
    expect(presetPeriod("year", "2026-09-05")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("periodFromFields — the two date inputs as one period", () => {
  it("both empty means no period at all", () => {
    expect(periodFromFields("", "")).toBeNull();
  });

  it("keeps only the halves that were filled", () => {
    expect(periodFromFields("2026-09-01", "")).toEqual({ from: "2026-09-01" });
    expect(periodFromFields("", "2026-09-30")).toEqual({ to: "2026-09-30" });
    expect(periodFromFields("2026-09-01", "2026-09-30")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });
});

describe("periodKey", () => {
  it("is empty for none and distinguishes every shape", () => {
    expect(periodKey(null)).toBe("");
    expect(periodKey({ from: "2026-09-01" })).toBe("2026-09-01~");
    expect(periodKey({ to: "2026-09-30" })).toBe("~2026-09-30");
    expect(periodKey({ from: "2026-09-01", to: "2026-09-30" })).toBe("2026-09-01~2026-09-30");
  });
});

describe("periodLabel — the chip names the unit when the range is one", () => {
  it("a single day", () => {
    expect(periodLabel({ from: "2026-09-05", to: "2026-09-05" })).toBe("2026/09/05");
  });

  it("a whole month or year", () => {
    expect(periodLabel({ from: "2026-09-01", to: "2026-09-30" })).toBe("2026年9月");
    expect(periodLabel({ from: "2028-02-01", to: "2028-02-29" })).toBe("2028年2月");
    expect(periodLabel({ from: "2026-01-01", to: "2026-12-31" })).toBe("2026年");
  });

  it("anything else as the range — a near-miss of a month is not the month", () => {
    expect(periodLabel({ from: "2026-09-01", to: "2026-09-29" })).toBe("2026/09/01 〜 2026/09/29");
    expect(periodLabel({ from: "2026-08-30", to: "2026-09-05" })).toBe("2026/08/30 〜 2026/09/05");
    expect(periodLabel({ from: "2026-01-01", to: "2026-12-30" })).toBe("2026/01/01 〜 2026/12/30");
  });

  it("an open half", () => {
    expect(periodLabel({ from: "2026-09-01" })).toBe("2026/09/01 以降");
    expect(periodLabel({ to: "2026-09-30" })).toBe("2026/09/30 以前");
    expect(periodLabel({})).toBe("");
  });
});

describe("spanInPeriod — overlap, both ends inclusive, an absent end is open", () => {
  const sept: Period = { from: "2026-09-01", to: "2026-09-30" };
  const day = (d: string) => ({ firstDay: d, lastDay: d });

  it("no period admits every 苔片", () => {
    expect(spanInPeriod(day("1999-01-01"), null)).toBe(true);
  });

  it("a single day: the edges are in, the neighbours are out", () => {
    expect(spanInPeriod(day("2026-09-01"), sept)).toBe(true);
    expect(spanInPeriod(day("2026-09-30"), sept)).toBe(true);
    expect(spanInPeriod(day("2026-08-31"), sept)).toBe(false);
    expect(spanInPeriod(day("2026-10-01"), sept)).toBe(false);
  });

  it("a 続く苔片 is in when any of its days is — the server's first_day <= to AND last_day >= from", () => {
    expect(spanInPeriod({ firstDay: "2026-08-30", lastDay: "2026-09-01" }, sept)).toBe(true);
    expect(spanInPeriod({ firstDay: "2026-09-30", lastDay: "2026-10-05" }, sept)).toBe(true);
    expect(spanInPeriod({ firstDay: "2026-08-01", lastDay: "2026-10-31" }, sept)).toBe(true);
    expect(spanInPeriod({ firstDay: "2026-08-01", lastDay: "2026-08-31" }, sept)).toBe(false);
    expect(spanInPeriod({ firstDay: "2026-10-01", lastDay: "2026-10-31" }, sept)).toBe(false);
  });

  it("an open half bounds one side only", () => {
    expect(spanInPeriod(day("2999-12-31"), { from: "2026-09-01" })).toBe(true);
    expect(spanInPeriod(day("2026-08-31"), { from: "2026-09-01" })).toBe(false);
    expect(spanInPeriod({ firstDay: "2026-08-01", lastDay: "2026-09-01" }, { from: "2026-09-01" })).toBe(true);
    expect(spanInPeriod(day("1999-01-01"), { to: "2026-09-30" })).toBe(true);
    expect(spanInPeriod(day("2026-10-01"), { to: "2026-09-30" })).toBe(false);
    expect(spanInPeriod({ firstDay: "2026-09-30", lastDay: "2026-10-31" }, { to: "2026-09-30" })).toBe(true);
  });
});
