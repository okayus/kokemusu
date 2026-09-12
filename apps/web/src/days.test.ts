import { describe, expect, it } from "vitest";
import {
  countDays,
  daysLabel,
  earliestStackDay,
  EVERY_DAY,
  isRange,
  isStackedNow,
  placeInFeed,
  postedLabel,
  stackingInput,
  THICKNESS_TICKS,
  thicknessLabel,
  thicknessNote,
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

describe("countDays — the range's days, the Worker's countDays spelled here", () => {
  it("counts both ends: 1 for a day, 731 for 2022-04-01 〜 2024-03-31 (ADR-0007's example, a leap day inside)", () => {
    expect(countDays("2026-09-05", "2026-09-05")).toBe(1);
    expect(countDays("2026-09-05", "2026-09-06")).toBe(2);
    expect(countDays("2022-04-01", "2024-03-31")).toBe(731);
    expect(countDays("2026-02-28", "2026-03-01")).toBe(2);
  });

  it("is 0 for an inverted pair or a field that is not a day", () => {
    expect(countDays("2026-09-06", "2026-09-05")).toBe(0);
    expect(countDays("", "2026-09-05")).toBe(0);
    expect(countDays("2026-09-05", "")).toBe(0);
  });
});

describe("isRange — when the two fields make a 続く苔片 (and so show the 厚み)", () => {
  it("needs both fields, いつ before 〜いつまで", () => {
    expect(isRange("2026-09-01", "2026-09-05")).toBe(true);
    expect(isRange("2026-09-05", "2026-09-05")).toBe(false);
    expect(isRange("2026-09-05", "2026-09-01")).toBe(false);
    expect(isRange("", "2026-09-05")).toBe(false);
    expect(isRange("2026-09-05", "")).toBe(false);
    expect(isRange("", "")).toBe(false);
  });
});

describe("THICKNESS_TICKS — the slider's 目盛り", () => {
  it("is 週 1 14 / 仕事 60 / 平日 71 / 毎日 100, ascending, ending where the slider starts", () => {
    expect(THICKNESS_TICKS.map((t) => [t.label, t.value])).toEqual([
      ["週 1", 14],
      ["仕事", 60],
      ["平日", 71],
      ["毎日", 100],
    ]);
    expect(THICKNESS_TICKS.at(-1)?.value).toBe(EVERY_DAY);
  });
});

describe("thicknessLabel / thicknessNote — the 厚み as the card, the summary and the slider say it", () => {
  it("names the declared 厚み", () => {
    expect(thicknessLabel(60)).toBe("厚み 60%");
    expect(thicknessLabel(100)).toBe("厚み 100%");
  });

  it("converts the range at the slider's 厚み the way the charts show 量 — 731 days at 60% are 439 (438.6), whole from 1 up", () => {
    expect(thicknessNote(60, "2022-04-01", "2024-03-31")).toBe("60% · 731 日のうち 439 日分");
    expect(thicknessNote(100, "2026-09-05", "2026-09-06")).toBe("100% · 2 日のうち 2 日分");
    // The number the stone will grow by, rounded as the stone shows it (1.2 → 量 1).
    expect(thicknessNote(60, "2026-09-05", "2026-09-06")).toBe("60% · 2 日のうち 1 日分");
    // Under a day the decimal stays, so a thin short range is not shown as nothing.
    expect(thicknessNote(14, "2026-09-05", "2026-09-06")).toBe("14% · 2 日のうち 0.3 日分");
  });
});

describe("stackingInput — the fields → one wire shape, the 厚み riding along", () => {
  const at = (firstDay: string, lastDay: string, thickness = EVERY_DAY) => ({
    firstDay,
    lastDay,
    thickness,
  });

  it("names no days when both are empty — and so no 厚み either, whatever the slider holds", () => {
    expect(stackingInput(at("", ""))).toEqual({});
    expect(stackingInput(at("", "", 60))).toEqual({});
  });

  it("makes one filled field a single day, whichever it is, with no 厚み (null)", () => {
    const single = { firstDay: "2026-09-05", lastDay: "2026-09-05", thickness: null };
    expect(stackingInput(at("2026-09-05", ""))).toEqual(single);
    expect(stackingInput(at("", "2026-09-05"))).toEqual(single);
    expect(stackingInput(at("2026-09-05", "2026-09-05"))).toEqual(single);
  });

  it("sends a range with the slider's 厚み — 毎日 where it starts, or wherever it was moved", () => {
    expect(stackingInput(at("2026-09-05", "2026-09-06"))).toEqual({
      firstDay: "2026-09-05",
      lastDay: "2026-09-06",
      thickness: 100,
    });
    expect(stackingInput(at("2026-09-05", "2026-09-06", 60))).toEqual({
      firstDay: "2026-09-05",
      lastDay: "2026-09-06",
      thickness: 60,
    });
  });

  it("drops the 厚み when a 続く苔片 is shortened to one day — the slider's position is not sent", () => {
    expect(stackingInput(at("2026-09-06", "2026-09-06", 60))).toEqual({
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
