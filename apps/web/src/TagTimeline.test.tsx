import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  assembleRows,
  axisTicks,
  barGeom,
  chartDomain,
  rowNote,
  spanTitle,
  TimelineChart,
  type AdhocEntry,
  type ChartRow,
} from "./TagTimeline";
import type { TimelineRow } from "./stats-api";

// Same 流儀 as Heatmap.test.tsx: the chart is pure output of props, so the
// geometry and structure a browser would be eyeballed for are asserted on the
// static markup, and the layout math on the exported pure functions.

const tag = (id: string, name = id) => ({ id, name });
const span = (firstDay: string, lastDay: string, count: number) => ({ firstDay, lastDay, count });
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

describe("axisTicks", () => {
  it("ticks by month on a short domain, naming the year at January", () => {
    const ticks = axisTicks({ from: "2026-11-20", to: "2027-03-05" });
    expect(ticks.map((t) => t.label)).toEqual(["12月", "2027年", "2月"]);
    // 3月 exists in the domain but sits under the 今日 label's zone.
    expect(ticks.every((t) => t.x <= 92)).toBe(true);
  });

  it("ticks by year on a multi-year domain", () => {
    const ticks = axisTicks({ from: "2020-01-15", to: "2026-09-03" });
    expect(ticks.map((t) => t.label)).toEqual([
      "2021年",
      "2022年",
      "2023年",
      "2024年",
      "2025年",
      "2026年",
    ]);
  });

  it("thins a decades-wide domain from the end, keeping the newest surviving year", () => {
    // On a 27-year domain the 今日 zone (x > 92) is ~2 years wide, so 2025 and
    // 2026 drop and the newest surviving tick is 2024; thinning (step 4 over
    // the remaining 25) walks back from it. 今日 itself labels the right edge.
    const ticks = axisTicks({ from: "2000-01-01", to: "2026-09-03" });
    expect(ticks.map((t) => t.label)).toEqual([
      "2000年",
      "2004年",
      "2008年",
      "2012年",
      "2016年",
      "2020年",
      "2024年",
    ]);
  });
});

describe("rowNote — 件数 + 密度（期間 ÷ 件数）", () => {
  it("shows one decimal under 10日/片 and rounds above", () => {
    expect(rowNote(span("2026-09-01", "2026-09-10", 5))).toBe("5 片 · 2.0日/片");
    expect(rowNote(span("2026-09-01", "2026-09-01", 1))).toBe("1 片 · 1.0日/片");
    expect(rowNote(span("2026-01-01", "2026-04-10", 2))).toBe("2 片 · 50日/片");
  });
});

describe("spanTitle", () => {
  it("names the period and the count, collapsing a one-day span", () => {
    expect(spanTitle(span("2026-04-01", "2026-09-03", 12))).toBe("2026-04-01 〜 2026-09-03 · 12 片");
    expect(spanTitle(span("2026-09-03", "2026-09-03", 2))).toBe("2026-09-03 · 2 片");
  });
});

describe("assembleRows — server rows + ad-hoc deep dives", () => {
  const base: TimelineRow[] = [
    { tags: [tag("f")], firstDay: "2026-01-01", lastDay: "2026-09-01", count: 9 },
    { tags: [tag("f"), tag("a")], firstDay: "2026-02-01", lastDay: "2026-03-01", count: 4 },
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
  it("draws each row's bar at its day-scaled position with the note beside it", () => {
    const html = render(
      [
        chartRow("a", span("2026-09-01", "2026-09-05", 5)),
        chartRow("b", span("2026-09-06", "2026-09-06", 1)),
      ],
      "2026-09-10",
    );
    expect(html).toContain('x="0%" y="3" width="50%"');
    expect(html).toContain('x="50%" y="3" width="10%"');
    expect(html).toContain("5 片 · 1.0日/片");
    // The bar carries its period for hover and for assistive tech.
    expect(html).toContain('aria-label="2026-09-01 〜 2026-09-05 · 5 片"');
    expect(html).toContain("<title>2026-09-06 · 1 片</title>");
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

  it("shows an empty AND row as 重なる苔片なし with 0 片, bar-less", () => {
    const html = render(
      [chartRow("a", span("2026-09-01", "2026-09-02", 2)), { ...chartRow("b", null), adhoc: true }],
      "2026-09-10",
    );
    expect(html).toContain("重なる苔片なし");
    expect(html).toContain("0 片");
    expect(html.match(/class="tl-span"/g)).toHaveLength(1);
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
