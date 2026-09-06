import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeatmapChart, leanOf, leanRatio, walkTarget } from "./Heatmap";
import type { Heatmap } from "./stats-api";

// The SVG grid is pure output of props, so the layout — the part a browser
// would be eyeballed for — is asserted on the static markup. Effects (the
// scroll-to-today) don't run under renderToStaticMarkup, which is fine: this
// is about geometry, not behaviour.

/** A window of days as [count, input, output] — every fixture 苔片 is a single day, so the totals are the cells' sums. */
const leaning = (from: string, tallies: [number, number, number][]): Heatmap => {
  const start = new Date(`${from}T00:00:00Z`);
  const days = tallies.map(([count, input, output], i) => {
    const d = new Date(start.getTime() + i * 86_400_000);
    return { day: d.toISOString().slice(0, 10), count, level: Math.min(count, 4), input, output };
  });
  const last = days[days.length - 1];
  if (last === undefined) throw new Error("series needs at least one day");
  const sum = (pick: (t: [number, number, number]) => number) =>
    tallies.reduce((n, t) => n + pick(t), 0);
  return {
    from,
    to: last.day,
    total: sum((t) => t[0]),
    input: sum((t) => t[1]),
    output: sum((t) => t[2]),
    days,
  };
};

/** A window with no 向き on it: counts alone. */
const series = (from: string, counts: number[]): Heatmap =>
  leaning(
    from,
    counts.map((count) => [count, 0, 0]),
  );

const render = (data: Heatmap) =>
  renderToStaticMarkup(<HeatmapChart label="総草" data={data} onDayTap={() => {}} />);

describe("HeatmapChart lays weeks out as columns, Sunday first", () => {
  it("puts a Sunday `from` at the origin and wraps after Saturday", () => {
    // 2026-08-30 is a Sunday; 8 days = column 0 full + one cell in column 1.
    const html = render(series("2026-08-30", [0, 1, 2, 3, 4, 5, 0, 1]));
    // Cell x/y: gutter 22/14, step 13. First cell at (22, 14)…
    expect(html).toContain('x="22" y="14"');
    // …Saturday at row 6 (y = 14 + 6*13)…
    expect(html).toContain('x="22" y="92"');
    // …and day 8 opens column 1 back at row 0.
    expect(html).toContain('x="35" y="14"');
  });

  it("starts a mid-week `from` on its own weekday row", () => {
    // 2026-09-02 is a Wednesday (row 3): y = 14 + 3*13 = 53.
    const html = render(series("2026-09-02", [1]));
    expect(html).toContain('x="22" y="53"');
    expect(html).not.toContain('y="14"');
  });

  it("shades by the server's level and marks today", () => {
    const html = render(series("2026-08-30", [0, 1, 2, 3, 4, 9]));
    for (const lv of [0, 1, 2, 3, 4]) expect(html).toContain(`class="heatmap-cell l${lv}"`);
    // 9 苔片 still wear the saturated shade, and the last day is today.
    expect(html).toContain('class="heatmap-cell l4 today"');
    expect(html.match(/today/g)).toHaveLength(1);
  });

  it("gives every cell its 「M/D · N 件」 title and the figure its 計", () => {
    const html = render(series("2026-08-30", [0, 1, 2]));
    expect(html).toContain("<title>8/30 · 0 件</title>");
    expect(html).toContain("<title>9/1 · 2 件</title>");
    expect(html).toContain("計 3 片");
  });

  it("labels a month at the column holding its 1st, leaving a partial lead month bare", () => {
    // Window starts Friday 8/28; September 1st (a Tuesday) falls in column 1,
    // the column opened by Sunday 8/30 — that column gets the 9月 label.
    const html = render(series("2026-08-28", [0, 0, 0, 0, 0, 1, 0]));
    expect(html).toContain(">9月</text>");
    expect(html).not.toContain(">8月</text>");
  });

  it("keeps weekday labels on 月・水・金", () => {
    const html = render(series("2026-08-30", [0]));
    for (const w of ["月", "水", "金"]) expect(html).toContain(`>${w}</text>`);
    expect(html).not.toContain(">日</text>");
  });
});

describe("HeatmapChart offers every cell as a button (visualization.md §1: マスのタップ → その日の投稿一覧)", () => {
  const html = render(series("2026-08-30", [0, 1, 2]));

  it("names each cell with its day as the period chip will spell it, and its count", () => {
    // Same rebuilt-button contract as the graph's stones; the name carries the
    // year because a 53-week window can hold the same M/D twice.
    expect(html).toContain('aria-label="2026/08/30 · 0 件"');
    expect(html).toContain('aria-label="2026/09/01 · 2 件"');
    expect(html.match(/role="button"/g)).toHaveLength(3);
    expect(html).toContain('data-day="2026-09-01"');
  });

  it("keeps one tab stop — today — and parks the other cells at -1", () => {
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
    expect(html).toMatch(/class="heatmap-cell l2 today"[^>]*tabindex="0"/);
  });

  it("is a group, not an image — an image's children would lose their button role", () => {
    expect(html).toContain('role="group"');
    expect(html).not.toContain('role="img"');
    // The axis text is for the eye; the cells carry the days.
    expect(html).toMatch(/<g aria-hidden="true">.*>9月<\/text>/);
  });
});

describe("HeatmapChart colours a day by its lean (visualization.md §1: 色相は「向き」、濃さは件数のまま)", () => {
  // 9/1 leans 吸う, 9/2 leans 出す, 9/3 is a tie, 9/4 is 未分類 only, 9/5 (today) is empty.
  const html = render(
    leaning("2026-09-01", [
      [3, 2, 1],
      [2, 0, 2],
      [2, 1, 1],
      [1, 0, 0],
      [0, 0, 0],
    ]),
  );

  it("adds `in` / `out` to the leaning cells and nothing to a tie, a 未分類 day or an empty one", () => {
    expect(html).toContain('class="heatmap-cell l3 in"');
    expect(html).toContain('class="heatmap-cell l2 out"');
    expect(html).toContain('class="heatmap-cell l2"');
    expect(html).toContain('class="heatmap-cell l1"');
    expect(html).toContain('class="heatmap-cell l0 today"');
  });

  it("reads the two sides out with the count — name and tooltip — only where some 苔片 faces a way", () => {
    expect(html).toContain('aria-label="2026/09/01 · 3 件（インプット 2・アウトプット 1）"');
    expect(html).toContain("<title>9/1 · 3 件（インプット 2・アウトプット 1）</title>");
    expect(html).toContain('aria-label="2026/09/03 · 2 件（インプット 1・アウトプット 1）"');
    expect(html).toContain('aria-label="2026/09/04 · 1 件"');
    expect(html).toContain('aria-label="2026/09/05 · 0 件"');
    expect(html).toContain("<title>9/5 · 0 件</title>");
  });

  it("captions the window's ratio next to 計 and puts it in the group's name", () => {
    // 8 苔片 in the window, 3 facing in, 4 facing out: 37.5 rounds to 38.
    expect(html).toContain('<span class="heatmap-total">計 8 片</span>');
    expect(html).toContain('<span class="heatmap-lean">吸う 38% · 出す 50%</span>');
    expect(html).toMatch(/aria-label="総草: [^"]*計 8 片、吸う 38% · 出す 50%"/);
  });

  it("keeps the ratio off a garden that never uses 向き, and off an empty one (the legend still names the hues)", () => {
    const plain = render(series("2026-08-30", [0, 1, 2]));
    expect(plain).not.toContain("heatmap-lean");
    expect(plain).toContain('aria-label="総草: 2026-08-30 から 2026-09-01 のヒートマップ、計 3 片"');
    expect(plain).toContain("計 3 片");
    expect(render(series("2026-08-30", [0]))).not.toContain("heatmap-lean");
  });

  it("adds the two hues to the legend, one swatch each", () => {
    expect(html).toMatch(/<i class="in"><\/i>吸う/);
    expect(html).toMatch(/<i class="out"><\/i>出す/);
  });
});

describe("leanOf — the hue is the majority side, and a tie is no hue", () => {
  it.each([
    [2, 1, "in"],
    [1, 0, "in"],
    [0, 3, "out"],
    [1, 1, null],
    [0, 0, null],
  ] as const)("(%i 吸う, %i 出す) → %s", (input, output, lean) => {
    expect(leanOf(input, output)).toBe(lean);
  });
});

describe("leanRatio — each side over the whole window, rounded", () => {
  it("shows both sides of the 苔片 that face a way, `both` on each", () => {
    expect(leanRatio({ total: 3, input: 2, output: 2 })).toBe("吸う 67% · 出す 67%");
    expect(leanRatio({ total: 5, input: 2, output: 0 })).toBe("吸う 40% · 出す 0%");
  });

  it("is nothing while no 苔片 faces a way", () => {
    expect(leanRatio({ total: 0, input: 0, output: 0 })).toBeNull();
    expect(leanRatio({ total: 7, input: 0, output: 0 })).toBeNull();
  });
});

describe("walkTarget — the arrow keys walk the dense day series", () => {
  it("↑↓ step a day, ←→ a week, Home/End the window's ends", () => {
    expect(walkTarget("ArrowUp", 10, 30)).toBe(9);
    expect(walkTarget("ArrowDown", 10, 30)).toBe(11);
    expect(walkTarget("ArrowLeft", 10, 30)).toBe(3);
    expect(walkTarget("ArrowRight", 10, 30)).toBe(17);
    expect(walkTarget("Home", 10, 30)).toBe(0);
    expect(walkTarget("End", 10, 30)).toBe(29);
  });

  it("stays put at the window's edges and is no walk for other keys", () => {
    expect(walkTarget("ArrowUp", 0, 30)).toBe(0);
    expect(walkTarget("ArrowLeft", 3, 30)).toBe(3);
    expect(walkTarget("ArrowRight", 25, 30)).toBe(25);
    expect(walkTarget("ArrowDown", 29, 30)).toBe(29);
    expect(walkTarget("Enter", 10, 30)).toBeNull();
    expect(walkTarget(" ", 10, 30)).toBeNull();
    expect(walkTarget("Tab", 10, 30)).toBeNull();
  });
});
