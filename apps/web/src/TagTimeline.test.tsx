import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  assembleRows,
  axisTicks,
  barGeom,
  barThickness,
  chartDomain,
  labelPx,
  monthSegments,
  monthTitle,
  rowNote,
  segmentAt,
  spanTitle,
  thicknessLevel,
  TimelineChart,
  type AdhocEntry,
  type ChartRow,
} from "./TagTimeline";
import type { MonthAmount, TimelineRow } from "./stats-api";

// Same 流儀 as Heatmap.test.tsx: the chart is pure output of props, so the
// geometry and structure a browser would be eyeballed for are asserted on the
// static markup, and the layout math on the exported pure functions.

const tag = (id: string, name = id) => ({ id, name });
const m = (month: string, amount = 1): MonthAmount => ({ month, amount });
/** A span whose 量 is its count unless said otherwise — single days, the common case. */
const span = (
  firstDay: string,
  lastDay: string,
  count: number,
  months: MonthAmount[] = [],
  amount: number = count,
) => ({
  firstDay,
  lastDay,
  count,
  amount,
  months,
});
const chartRow = (id: string, s: ChartRow["span"]): ChartRow => ({
  key: id,
  tags: [tag(id)],
  span: s,
});

const render = (rows: ChartRow[], today: string, deepDive?: Parameters<typeof TimelineChart>[0]["deepDive"]) =>
  renderToStaticMarkup(
    <TimelineChart rows={rows} today={today} onTagTap={() => {}} deepDive={deepDive} />,
  );

describe("barGeom — days as the unit, percentages of [domain.from, today]", () => {
  const domain = { from: "2026-09-01", to: "2026-09-10" }; // 10 days

  it("covers first through last day inclusive", () => {
    expect(barGeom(span("2026-09-01", "2026-09-05", 1), domain)).toEqual({ x: 0, w: 50 });
    expect(barGeom(span("2026-09-06", "2026-09-06", 1), domain)).toEqual({ x: 50, w: 10 });
    expect(barGeom(span("2026-09-01", "2026-09-10", 1), domain)).toEqual({ x: 0, w: 100 });
  });

  it("floors a one-day stone on a years-long axis to a visible dot", () => {
    const years = { from: "2020-01-01", to: "2026-12-31" };
    const { w } = barGeom(span("2023-06-01", "2023-06-01", 1), years);
    expect(w).toBe(1.2);
  });

  it("keeps a floored bar at the right edge inside the axis", () => {
    const years = { from: "2020-01-01", to: "2026-12-31" };
    expect(barGeom(span("2026-12-31", "2026-12-31", 1), years)).toEqual({ x: 98.8, w: 1.2 });
  });
});

describe("monthSegments — the 活動月 cut to the span, on the bar's own axis", () => {
  const domain = { from: "2026-01-01", to: "2026-03-31" }; // 90 days

  it("cuts the first and last months to the span and leaves a dormant month unpainted", () => {
    const s = span("2026-01-15", "2026-03-10", 5, [m("2026-01", 3), m("2026-03", 2)]);
    expect(monthSegments(s, domain)).toEqual([
      // Jan 15–31 = 17 days, starting on day 14 of the axis; 量 3 over the 17 days it covers.
      { month: "2026-01", amount: 3, x: 15.556, w: 18.889, thickness: 3 / 17 },
      // Mar 1–10 = 10 days from day 59; February is not there.
      { month: "2026-03", amount: 2, x: 65.556, w: 11.111, thickness: 0.2 },
    ]);
  });

  it("paints an interior month whole, its 厚み over the whole month", () => {
    const s = span("2026-01-15", "2026-03-10", 6, [m("2026-01"), m("2026-02", 4), m("2026-03")]);
    expect(monthSegments(s, domain)[1]).toEqual({
      month: "2026-02",
      amount: 4,
      x: 34.444,
      w: 31.111,
      thickness: 4 / 28,
    });
  });

  it("measures a partial first month over its own days — a 続く苔片 is as thick there as in its full months", () => {
    // 60% from Jan 20: the 12 days of January carry 7.2, the 28 of February 16.8.
    const s = span("2026-01-20", "2026-03-10", 1, [m("2026-01", 7.2), m("2026-02", 16.8)], 30);
    expect(monthSegments(s, domain).map((seg) => seg.thickness)).toEqual([0.6, 0.6]);
  });

  it("skips a month the span does not reach instead of drawing off the bar", () => {
    const s = span("2026-02-01", "2026-02-10", 1, [m("2025-12"), m("2026-02")]);
    expect(monthSegments(s, domain).map((seg) => seg.month)).toEqual(["2026-02"]);
  });

  it("floors an isolated month on a years-long axis to the same visible dot as a bar", () => {
    const years = { from: "2016-01-01", to: "2026-12-31" };
    const s = span("2016-01-01", "2026-12-31", 2, [m("2019-06"), m("2026-12")]);
    const segs = monthSegments(s, years);
    expect(segs.map((seg) => seg.w)).toEqual([1.2, 1.2]);
    // The floored last month stays inside the axis, like a floored bar.
    expect(segs[1]?.x).toBe(98.8);
  });
});

describe("chartDomain", () => {
  it("spans the earliest first 苔片 to today, skipping empty rows", () => {
    const rows = [
      chartRow("a", span("2026-03-05", "2026-04-01", 3)),
      chartRow("b", span("2026-01-15", "2026-02-01", 2)),
      chartRow("empty", null),
    ];
    expect(chartDomain(rows, "2026-09-03")).toEqual({ from: "2026-01-15", to: "2026-09-03" });
  });

  it("collapses to today alone when nothing has a span", () => {
    expect(chartDomain([chartRow("empty", null)], "2026-09-03")).toEqual({
      from: "2026-09-03",
      to: "2026-09-03",
    });
  });
});

describe("axisTicks — labels for an axis of a given pixel width", () => {
  const labels = (domain: Parameters<typeof axisTicks>[0], axisPx: number) =>
    axisTicks(domain, axisPx).map((t) => t.label);

  it("estimates a label's width from its glyphs: 5.5px a digit, 9px a CJK glyph", () => {
    expect(labelPx("2026年")).toBe(31);
    expect(labelPx("12月")).toBe(20);
    expect(labelPx("今日")).toBe(18);
  });

  it("ticks by month on a short domain, naming the year at January", () => {
    // 106 days on 400px: every month fits, but 3月 (x ≈ 95%) would run into 今日.
    expect(labels({ from: "2026-11-20", to: "2027-03-05" }, 400)).toEqual(["12月", "2027年", "2月"]);
  });

  it("yields to 今日 by pixels, not by a fixed zone", () => {
    // The same domain on 120px: 2月 (x ≈ 69%) now ends inside 今日's room too.
    expect(labels({ from: "2026-11-20", to: "2027-03-05" }, 120)).toEqual(["12月", "2027年"]);
  });

  it("coarsens months to calendar quarters when neighbours would touch", () => {
    // 288 days on 200px: 12月 and 2026年 (29px) would overlap, so the ladder
    // steps to 1・4・7・10月 — January (the year) kept, not every other month.
    expect(labels({ from: "2025-11-20", to: "2026-09-03" }, 200)).toEqual(["2026年", "4月", "7月"]);
  });

  it("ticks by year on a multi-year domain", () => {
    expect(labels({ from: "2020-01-15", to: "2026-09-03" }, 600)).toEqual([
      "2021年",
      "2022年",
      "2023年",
      "2024年",
      "2025年",
      "2026年",
    ]);
  });

  it("drops the last year rather than let it run into 今日", () => {
    // 2026年 starts at x ≈ 90%: on 400px its 29px would reach the 今日 label.
    expect(labels({ from: "2020-01-15", to: "2026-09-03" }, 400)).toEqual([
      "2021年",
      "2022年",
      "2023年",
      "2024年",
      "2025年",
    ]);
  });

  it("thins years on a narrow axis to a calendar-aligned interval", () => {
    // ~30px per year on 200px: single years collide, even years clear.
    expect(labels({ from: "2020-01-15", to: "2026-09-03" }, 200)).toEqual(["2022年", "2024年"]);
    // 27 years on 360px: 1 and 2 collide, 5 clears; 2025 yields to 今日.
    expect(labels({ from: "2000-01-01", to: "2026-09-03" }, 360)).toEqual([
      "2000年",
      "2005年",
      "2010年",
      "2015年",
      "2020年",
    ]);
  });

  it("leaves only 今日 on an unmeasured axis or a one-day domain", () => {
    expect(labels({ from: "2000-01-01", to: "2026-09-03" }, 0)).toEqual([]);
    expect(labels({ from: "2026-09-03", to: "2026-09-03" }, 600)).toEqual([]);
  });
});

describe("segmentAt — the segment under a point of the axis", () => {
  const seg = (month: string, x: number, w: number) => ({ month, amount: 1, x, w, thickness: 1 });
  const segs = [seg("2026-01", 10, 20), seg("2026-03", 50, 5)];

  it("finds the segment whose extent holds the point, ends included", () => {
    expect(segmentAt(segs, 10)?.month).toBe("2026-01");
    expect(segmentAt(segs, 30)?.month).toBe("2026-01");
    expect(segmentAt(segs, 52)?.month).toBe("2026-03");
  });

  it("is null over a dormant month or off the era", () => {
    expect(segmentAt(segs, 40)).toBeNull();
    expect(segmentAt(segs, 5)).toBeNull();
    expect(segmentAt([], 5)).toBeNull();
  });
});

describe("barThickness — 太さ ＝ 量, the graph's √ law on a 20px lane", () => {
  it("gives one 苔片 4px, a month of every day 10px, and caps at 15px from 量 100", () => {
    expect(barThickness(1)).toBe(4);
    expect(barThickness(6)).toBe(6);
    expect(barThickness(30)).toBe(10);
    expect(barThickness(100)).toBe(15);
    expect(barThickness(438.6)).toBe(15);
  });

  it("keeps a clipped or thin 量 a visible bar", () => {
    expect(barThickness(0.5)).toBe(4);
    expect(barThickness(0.02)).toBe(3);
  });
});

describe("thicknessLevel — 濃さ ＝ 厚み on the 総草's four steps", () => {
  it("steps at a day in five, half the days, and every day", () => {
    expect(thicknessLevel(0.03)).toBe(1);
    expect(thicknessLevel(0.2)).toBe(1);
    expect(thicknessLevel(0.21)).toBe(2);
    expect(thicknessLevel(0.5)).toBe(2);
    expect(thicknessLevel(0.6)).toBe(3);
    expect(thicknessLevel(0.99)).toBe(3);
    expect(thicknessLevel(1)).toBe(4);
  });

  it("keeps several 苔片 a day on the top step, as the 総草 does", () => {
    expect(thicknessLevel(3)).toBe(4);
  });
});

describe("monthTitle — the tip's month line", () => {
  it("names the month, its 量 and its own 厚み", () => {
    expect(monthTitle({ month: "2026-01", amount: 3, thickness: 3 / 17 })).toBe("2026-01 · 量 3 · 厚み 18%");
    expect(monthTitle({ month: "2026-02", amount: 16.8, thickness: 0.6 })).toBe("2026-02 · 量 17 · 厚み 60%");
  });
});

describe("rowNote — 「量 N · 厚み x%」, the 厚み measured over the row's period", () => {
  it("reads a 続く苔片's own 厚み back, and a single day as 100%", () => {
    expect(rowNote(span("2026-09-01", "2026-09-10", 1, [], 6))).toBe("量 6 · 厚み 60%");
    expect(rowNote(span("2026-09-01", "2026-09-01", 1))).toBe("量 1 · 厚み 100%");
    expect(rowNote(span("2022-04-01", "2024-03-31", 1, [], 438.6))).toBe("量 439 · 厚み 60%");
  });

  it("measures several single days over their spread — 5 in 10 days is 50%", () => {
    expect(rowNote(span("2026-09-01", "2026-09-10", 5))).toBe("量 5 · 厚み 50%");
    expect(rowNote(span("2026-01-01", "2026-04-10", 2))).toBe("量 2 · 厚み 2%");
  });

  it("passes 100% when a day holds several 苔片, and shows a 量 under 1 with a decimal", () => {
    expect(rowNote(span("2026-09-01", "2026-09-01", 3))).toBe("量 3 · 厚み 300%");
    expect(rowNote(span("2026-09-01", "2026-09-10", 1, [], 0.5))).toBe("量 0.5 · 厚み 5%");
  });
});

describe("spanTitle", () => {
  it("names the period and the count, collapsing a one-day span", () => {
    expect(spanTitle(span("2026-04-01", "2026-04-20", 12, [m("2026-04", 12)]))).toBe(
      "2026-04-01 〜 2026-04-20 · 12 片",
    );
    expect(spanTitle(span("2026-09-03", "2026-09-03", 2, [m("2026-09", 2)]))).toBe(
      "2026-09-03 · 2 片",
    );
  });

  it("adds the 活動月 ratio once the span crosses a month — the gap, in words", () => {
    const s = span("2026-04-01", "2026-09-03", 12, [m("2026-04", 9), m("2026-09", 3)]);
    expect(spanTitle(s)).toBe("2026-04-01 〜 2026-09-03 · 12 片 · 活動 2/6 か月");
  });
});

describe("assembleRows — server rows + ad-hoc deep dives", () => {
  const base: TimelineRow[] = [
    { tags: [tag("f")], firstDay: "2026-01-01", lastDay: "2026-09-01", count: 9, amount: 9, months: [] },
    {
      tags: [tag("f"), tag("a")],
      firstDay: "2026-02-01",
      lastDay: "2026-03-01",
      count: 4,
      amount: 4,
      months: [],
    },
  ];
  const adhoc = (key: string, afterKey: string): AdhocEntry => ({
    key,
    afterKey,
    tags: [tag("f"), tag("a"), tag("x")],
    span: span("2026-02-10", "2026-02-20", 2),
    loading: false,
  });

  it("slots an ad-hoc row right under the row it deepens, chains included", () => {
    const rows = assembleRows(base, [adhoc("f+a+x", "f+a"), adhoc("f+a+x+y", "f+a+x")]);
    expect(rows.map((r) => r.key)).toEqual(["f", "f+a", "f+a+x", "f+a+x+y"]);
    expect(rows[2]?.adhoc).toBe(true);
  });

  it("keeps an orphaned deep dive at the end instead of dropping it", () => {
    const rows = assembleRows(base, [adhoc("gone+x", "gone")]);
    expect(rows.map((r) => r.key)).toEqual(["f", "f+a", "gone+x"]);
  });
});

describe("TimelineChart markup", () => {
  it("draws each row's bar at its day-scaled position, as thick as its 量, centred on the track", () => {
    const html = render(
      [
        chartRow("a", span("2026-09-01", "2026-09-05", 5)),
        chartRow("b", span("2026-09-06", "2026-09-06", 1)),
      ],
      "2026-09-10",
    );
    // 量 5 is 6px on the 20px lane (y 7), 量 1 is 4px (y 8).
    expect(html).toContain('class="tl-span" x="0%" y="7" width="50%" height="6" rx="4"');
    expect(html).toContain('class="tl-span" x="50%" y="8" width="10%" height="4" rx="4"');
    expect(html).toContain('class="tl-track" x1="0" x2="100%" y1="10" y2="10"');
    // The drawing is decorative; the hit target over the era carries the
    // period, the count and the numbers for assistive tech …
    expect(html).toContain('<svg class="tl-bar" aria-hidden="true">');
    expect(html).toContain('aria-label="2026-09-01 〜 2026-09-05 · 5 片 · 量 5 · 厚み 100%"');
    expect(html).toContain('aria-label="2026-09-06 · 1 片 · 量 1 · 厚み 100%"');
    // … and opens the row's tip, a popover it targets by id and by interest
    // (React writes popoverTarget in camel case; HTML attributes are case-blind).
    const hit = html.match(
      /<button type="button" class="tl-hit" style="inset-inline-start:0%;inline-size:50%" popoverTarget="([^"]+)" interestfor="([^"]+)"/,
    );
    expect(hit?.[1]).toBeDefined();
    expect(hit?.[2]).toBe(hit?.[1]);
    // The row's own anchor name, handed to the button and the tip through
    // the lane (a shared name would anchor every tip to the last row).
    const lane = html.match(/<span class="tl-lane" style="--tl-anchor:--tl-([^"]+)">/);
    expect(`${lane?.[1]}t`).toBe(hit?.[1]);
    expect(html).toContain(
      `<div id="${hit?.[1]}" popover="auto" class="tl-tip"><strong>量 5 · 厚み 100%</strong><span>2026-09-01 〜 2026-09-05 · 5 片</span></div>`,
    );
    // The legend, in the 総草's swatches.
    expect(html).toContain('<div class="tl-legend" aria-hidden="true">');
    expect(html.match(/<i class="l[1-4]"><\/i>/g)).toHaveLength(4);
  });

  it("paints only the 活動月 as segments, each on its step of moss, clipped to the era bar", () => {
    const html = render(
      [chartRow("a", span("2026-01-15", "2026-03-10", 5, [m("2026-01", 3), m("2026-03", 2)]))],
      "2026-03-31",
    );
    // The axis opens on the row's first day (chartDomain): 76 days to today.
    // The era underlay, first 苔片 to last (55 days), 6px for its 量 5 …
    expect(html).toContain('class="tl-span" x="0%" y="7" width="72.368%" height="6" rx="4"');
    // … and one segment per active month — none for dormant February — on
    // the step of its own 厚み: 3 in 17 days and 2 in 10 are both たまに.
    expect(html.match(/class="tl-month l\d"/g)).toHaveLength(2);
    expect(html).toContain('class="tl-month l1" x="0%" y="7" width="22.368%" height="6"');
    expect(html).toContain('class="tl-month l1" x="59.211%" y="7" width="13.158%" height="6"');
    // The segments sit in a group cut to the era's rounded outline, per bar.
    const clipId = html.match(/<clipPath id="([^"]+)"/)?.[1];
    expect(clipId).toBeDefined();
    expect(html).toContain(`clip-path="url(#${clipId})"`);
    // What a screen reader hears of the gap, and the tip's two lines (the
    // month line waits for a pointer).
    expect(html).toContain(
      'aria-label="2026-01-15 〜 2026-03-10 · 5 片 · 活動 2/3 か月 · 量 5 · 厚み 9%"',
    );
    expect(html).toContain(
      '<strong>量 5 · 厚み 9%</strong><span>2026-01-15 〜 2026-03-10 · 5 片 · 活動 2/3 か月</span></div>',
    );
  });

  it("darkens a segment with its month's 厚み", () => {
    const html = render(
      [
        chartRow(
          "a",
          span("2026-01-01", "2026-03-31", 1, [m("2026-01", 9.3), m("2026-02", 16.8), m("2026-03", 31)], 57.1),
        ),
      ],
      "2026-03-31",
    );
    // 30% in January, 60% in February, every day in March.
    expect(html).toContain('class="tl-month l2" x="0%"');
    expect(html).toContain('class="tl-month l3" x="34.444%"');
    expect(html).toContain('class="tl-month l4" x="65.556%"');
  });

  it("keeps the rows in the order given — the server owns 開始日順", () => {
    const html = render(
      [
        chartRow("later", span("2026-05-01", "2026-06-01", 2)),
        chartRow("earlier", span("2026-01-01", "2026-02-01", 2)),
      ],
      "2026-09-10",
    );
    expect(html.indexOf(">later<")).toBeLessThan(html.indexOf(">earlier<"));
  });

  it("renders every stone as a tappable chip and labels the axis with 今日", () => {
    const html = render(
      [
        {
          key: "f+a",
          tags: [tag("f", "XX案件"), tag("a", "Vue.js")],
          span: span("2026-01-01", "2026-03-01", 6),
        },
      ],
      "2026-09-10",
    );
    expect(html).toContain('<button type="button" class="tag-chip">XX案件</button>');
    expect(html).toContain('<button type="button" class="tag-chip">Vue.js</button>');
    expect(html).toContain(">今日</text>");
    // January wears the year — the 年表's spine — and later months their 月.
    expect(html).toContain(">2026年</text>");
    expect(html).toContain(">2月</text>");
  });

  it("lays the axis out for the nominal width until the browser measures it", () => {
    // Static markup never runs layout: 320px is assumed, on which every year
    // of this domain fits except 2026, which would run into 今日.
    const html = render([chartRow("a", span("2020-01-15", "2020-02-01", 2))], "2026-09-10");
    expect(html).toContain(">2021年</text>");
    expect(html).toContain(">2025年</text>");
    expect(html).not.toContain(">2026年</text>");
  });

  it("shows an empty AND row as 重なる苔片なし, bar-less and tip-less", () => {
    const html = render(
      [chartRow("a", span("2026-09-01", "2026-09-02", 2)), { ...chartRow("b", null), adhoc: true }],
      "2026-09-10",
    );
    expect(html).toContain("重なる苔片なし");
    expect(html.match(/class="tl-span"/g)).toHaveLength(1);
    expect(html.match(/class="tl-tip"/g)).toHaveLength(1);
  });

  it("offers the deep-dive controls only when focus mode passes them", () => {
    const rows = [chartRow("f", span("2026-09-01", "2026-09-02", 2))];
    expect(render(rows, "2026-09-10")).not.toContain("石を足して深掘り");
    const html = render(rows, "2026-09-10", {
      options: [tag("x", "Hono")],
      openFor: null,
      error: null,
      onToggle: () => {},
      onPick: () => {},
      onRemove: () => {},
    });
    expect(html).toContain('aria-label="f に石を足して深掘り"');
    expect(html).toContain('<option value="Hono">');
  });
});
