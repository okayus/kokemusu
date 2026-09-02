import { useEffect, useRef, useState } from "react";
import { getHeatmap, type Heatmap } from "./stats-api";
import type { TagSummary } from "./posts-api";

// 苔のヒートマップ（docs/visualization.md §1): weeks as columns, weekdays as
// rows (Sunday first, plans/vertical-slice.md), five moss shades. Hand-written
// SVG on a fixed grid; the wrapper scrolls horizontally and starts at the
// right edge, where today is.

const CELL = 11;
const GAP = 2; // dataviz: a 2px surface gap between fills
const STEP = CELL + GAP;
const GUTTER_X = 22; // room for 月/水/金
const GUTTER_Y = 14; // room for month labels
const WEEKDAY_ROWS = [
  { row: 1, text: "月" },
  { row: 3, text: "水" },
  { row: 5, text: "金" },
];

/** Weekday of a `YYYY-MM-DD` civil date, 0 = Sunday — same math as worker/core/day.ts. */
const weekdayOf = (day: string) =>
  new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))).getUTCDay();

const monthDay = (day: string) => `${+day.slice(5, 7)}/${+day.slice(8, 10)}`;

// Exported for the markup test — the grid math (columns, rows, labels) is
// locked there because no in-sandbox browser can eyeball it (e2e is PR6).
export function HeatmapChart(props: { label: string; data: Heatmap }) {
  const { label, data } = props;
  const offset = weekdayOf(data.from);
  const cells = data.days.map((d, i) => ({
    ...d,
    col: Math.floor((offset + i) / 7),
    row: (offset + i) % 7,
  }));
  const weeks = cells.length === 0 ? 0 : (cells[cells.length - 1]?.col ?? 0) + 1;
  const total = data.days.reduce((sum, d) => sum + d.count, 0);
  const width = GUTTER_X + weeks * STEP + 1;
  const height = GUTTER_Y + 7 * STEP + 1;

  // Each month is labelled at the column its 1st day falls in (a leading
  // partial month goes unlabelled rather than colliding with its neighbour).
  const months = cells.filter((c) => c.day.endsWith("-01"));

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Today lives at the right edge; start there. Keyed on the window, not the
    // data, so a refetch after posting doesn't yank the reader's scroll back.
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data.from, data.to]);

  return (
    <figure className="heatmap">
      <figcaption className="heatmap-caption">
        <span>{label}</span>
        <span className="heatmap-total">計 {total} 片</span>
      </figcaption>
      <div className="heatmap-scroll" ref={scrollRef}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label}: ${data.from} から ${data.to} のヒートマップ、計 ${total} 片`}
        >
          {months.map((m) => (
            <text
              key={m.day}
              className="heatmap-axis"
              x={GUTTER_X + m.col * STEP}
              y={GUTTER_Y - 4}
            >
              {+m.day.slice(5, 7)}月
            </text>
          ))}
          {WEEKDAY_ROWS.map((w) => (
            <text
              key={w.text}
              className="heatmap-axis"
              x={GUTTER_X - 5}
              y={GUTTER_Y + w.row * STEP + CELL - 2}
              textAnchor="end"
            >
              {w.text}
            </text>
          ))}
          {cells.map((c) => (
            <rect
              key={c.day}
              className={`heatmap-cell l${c.level}${c.day === data.to ? " today" : ""}`}
              x={GUTTER_X + c.col * STEP}
              y={GUTTER_Y + c.row * STEP}
              width={CELL}
              height={CELL}
              rx={2}
            >
              <title>{`${monthDay(c.day)} · ${c.count} 件`}</title>
            </rect>
          ))}
        </svg>
      </div>
      <div className="heatmap-legend" aria-hidden="true">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i key={level} className={`l${level}`} />
        ))}
        <span>多</span>
      </div>
    </figure>
  );
}

/** 総草 + タグごとに 1 枚。`refreshKey` bumps after a post so today darkens. */
export function HeatmapSection(props: {
  tags: TagSummary[];
  refreshKey: number;
  onFault: (e: unknown) => void;
}) {
  // Keyed by tag id ("" = 総草). Stale entries simply stop being rendered, and
  // a refetch replaces entries in place — no flicker back to a loading state.
  const [gardens, setGardens] = useState<ReadonlyMap<string, Heatmap>>(new Map());

  const { tags, refreshKey, onFault } = props;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [all, ...perTag] = await Promise.all([
          getHeatmap(),
          ...tags.map((t) => getHeatmap({ tag: t.name })),
        ]);
        if (cancelled) return;
        const next = new Map([["", all]]);
        tags.forEach((t, i) => {
          const garden = perTag[i];
          if (garden !== undefined) next.set(t.id, garden);
        });
        setGardens(next);
      } catch (e) {
        if (!cancelled) onFault(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tags, refreshKey, onFault]);

  const allGarden = gardens.get("");
  if (allGarden === undefined) return null; // first load: appear when grown
  return (
    <section className="heatmaps">
      <h2>苔</h2>
      <HeatmapChart label="総草" data={allGarden} />
      {tags.flatMap((t) => {
        const data = gardens.get(t.id);
        return data === undefined ? [] : [
          <HeatmapChart key={t.id} label={`${t.name} の苔`} data={data} />,
        ];
      })}
    </section>
  );
}
