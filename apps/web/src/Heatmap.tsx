import { useEffect, useRef, useState } from "react";
import { slashDay } from "./period";
import { getHeatmap, type Heatmap, type HeatmapDay } from "./stats-api";

// 総草 (docs/visualization.md §1): the one heatmap — the day's total activity,
// weeks as columns, weekdays as rows (Sunday first, plans/vertical-slice.md),
// five moss shades, and a hue for the day's 向き: 吸う (teal) when more of its
// 苔片 face in than out, 出す (red-brown) the other way, moss green on a tie,
// on 未分類 alone, and on nothing. It never splits by tag (2026-09-02 決定):
// per-tag devotion is the graph's and the tag timeline's job, not another
// garden of grids. Hand-written SVG on a fixed grid; the wrapper scrolls
// horizontally and starts at the right edge, where today is. Every cell is a
// button: tapping it lands on the post list narrowed to that one day.

const CELL = 11;
const GAP = 2; // dataviz: a 2px surface gap between fills
const STEP = CELL + GAP;
const GUTTER_X = 22; // room for 月/水/金
const GUTTER_Y = 14; // room for month labels
// A focused cell's ring (2px outline, 2px offset) reaches this far past the
// cell. The svg and the scroll wrapper clip whatever they don't contain, so
// the last column and the bottom row get that much room after their gap.
const RING = 4;
const WEEKDAY_ROWS = [
  { row: 1, text: "月" },
  { row: 3, text: "水" },
  { row: 5, text: "金" },
];

/** Weekday of a `YYYY-MM-DD` civil date, 0 = Sunday — same math as worker/core/day.ts. */
const weekdayOf = (day: string) =>
  new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))).getUTCDay();

const monthDay = (day: string) => `${+day.slice(5, 7)}/${+day.slice(8, 10)}`;

/** Which way a day leans — the cell's hue (visualization.md §1). */
export type Lean = "in" | "out";

/**
 * More 吸う than 出す is `in`, the reverse `out`; a tie, 未分類 alone and an
 * empty day are null and stay moss green. Two 11px hues are all the grid can
 * carry, so the counts themselves ride in the name and the tooltip.
 */
export function leanOf(input: number, output: number): Lean | null {
  if (input > output) return "in";
  if (output > input) return "out";
  return null;
}

/** 「（インプット a・アウトプット b）」 — spelled out once some 苔片 of the day faces a way. */
const breakdown = (cell: Pick<HeatmapDay, "input" | "output">) =>
  cell.input + cell.output > 0 ? `（インプット ${cell.input}・アウトプット ${cell.output}）` : "";

/**
 * The caption's 「吸う x% · 出す y%」: each side over every 苔片 overlapping the
 * window. `both` is on both sides and 未分類 is in the denominator, so the two
 * neither add to 100 nor need to reach it — what they show is the lean
 * (吸ってばかり / 出してばかり, CONTEXT.md 「向き」) and how much of the garden
 * says which way it faces. Null while nothing does: a garden that never uses
 * 向き shows no zeros.
 */
export function leanRatio(totals: {
  total: number;
  input: number;
  output: number;
}): string | null {
  if (totals.total === 0 || totals.input + totals.output === 0) return null;
  const pct = (n: number) => Math.round((n / totals.total) * 100);
  return `吸う ${pct(totals.input)}% · 出す ${pct(totals.output)}%`;
}

/**
 * A cell's accessible name. The window is 53 weeks, so an M/D can occur twice
 * in it — the name carries the year, spelled the way the period chip will read
 * once the cell is tapped, and the day's two sides when it has any (the hue in
 * words). The hover title stays short: the month labels are in view there.
 */
const cellName = (cell: HeatmapDay) =>
  `${slashDay(cell.day)} · ${cell.count} 件${breakdown(cell)}`;

/**
 * The keyboard walk over the dense day series (index = days from `from`):
 * ↑/↓ a day — one row, wrapping into the neighbouring column at Sunday and
 * Saturday — ←/→ a week — one column — Home/End the window's ends. `null` for
 * any other key; a step that would leave the window stays put.
 */
export function walkTarget(key: string, index: number, length: number): number | null {
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return length - 1;
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight": {
      const step = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : key === "ArrowLeft" ? -7 : 7;
      const next = index + step;
      return next >= 0 && next < length ? next : index;
    }
    default:
      return null;
  }
}

// Exported for the markup test — the grid math (columns, rows, labels) and
// the cells' button contract are locked there because no in-sandbox browser
// can eyeball them.
export function HeatmapChart(props: {
  label: string;
  data: Heatmap;
  onDayTap: (day: string) => void;
  /** Whether the section around it is hidden — the scroll to today re-runs when it comes back. */
  hidden?: boolean | undefined;
}) {
  const { label, data, onDayTap, hidden = false } = props;
  const offset = weekdayOf(data.from);
  const cells = data.days.map((d, i) => ({
    ...d,
    col: Math.floor((offset + i) / 7),
    row: (offset + i) % 7,
  }));
  const weeks = cells.length === 0 ? 0 : (cells[cells.length - 1]?.col ?? 0) + 1;
  // The server's count of 苔片 overlapping the window — not the cells' sum,
  // which a 続く苔片 would inflate by its length (ADR-0005) — and its 向き split.
  const total = data.total;
  const ratio = leanRatio(data);
  const width = GUTTER_X + weeks * STEP + RING;
  const height = GUTTER_Y + 7 * STEP + RING;

  // Each month is labelled at the column its 1st day falls in (a leading
  // partial month goes unlabelled rather than colliding with its neighbour).
  const months = cells.filter((c) => c.day.endsWith("-01"));

  // One tab stop for the whole grid — 53 weeks of cells would be that many
  // stops between the composer and the feed. The stop starts on today (the
  // right edge, where the scroll starts) and follows focus: the arrow keys
  // walk the cells and whichever cell was focused last keeps the stop. A stop
  // the window moved out from under reverts to today.
  const [stopDay, setStopDay] = useState<string | null>(null);
  const tabDay =
    stopDay !== null && data.from <= stopDay && stopDay <= data.to ? stopDay : data.to;

  const svgRef = useRef<SVGSVGElement>(null);
  const focusCell = (index: number) => {
    const target = cells[index];
    if (target === undefined) return;
    // focus() also scrolls the wrapper to the cell, so walking left across
    // the weeks brings the older columns into view.
    svgRef.current?.querySelector<SVGRectElement>(`[data-day="${target.day}"]`)?.focus();
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Today lives at the right edge; start there. Keyed on the window, not the
    // data, so a refetch after posting doesn't yank the reader's scroll back —
    // and on `hidden`, because a section that was display:none had no width to
    // scroll (a garden opened at /年表): it starts at today when it comes back.
    if (hidden) return;
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data.from, data.to, hidden]);

  return (
    <figure className="heatmap">
      <figcaption className="heatmap-caption">
        <span>{label}</span>
        <span className="heatmap-totals">
          <span className="heatmap-total">計 {total} 片</span>
          {ratio !== null && <span className="heatmap-lean">{ratio}</span>}
        </span>
      </figcaption>
      <div className="heatmap-scroll" ref={scrollRef}>
        {/* A group, not an image: an image's children are presentational, and
            these cells are buttons. */}
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="group"
          aria-label={`${label}: ${data.from} から ${data.to} のヒートマップ、計 ${total} 片${
            ratio === null ? "" : `、${ratio}`
          }`}
        >
          {/* Axis labels are context for the eye; every cell names its own day. */}
          <g aria-hidden="true">
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
          </g>
          {cells.map((c, i) => {
            const tap = () => onDayTap(c.day);
            const lean = leanOf(c.input, c.output);
            return (
              // No native button exists inside SVG, so this rebuilds one the way
              // the graph's stones do: role + tabindex + the native keyboard
              // contract — Enter on keydown, Space on keyup, keydown only
              // swallows the scroll (modern-web-guidance/accessibility §5) —
              // plus the walk (walkTarget) that makes one tab stop enough.
              <rect
                key={c.day}
                className={`heatmap-cell l${c.level}${lean === null ? "" : ` ${lean}`}${
                  c.day === data.to ? " today" : ""
                }`}
                data-day={c.day}
                role="button"
                tabIndex={c.day === tabDay ? 0 : -1}
                aria-label={cellName(c)}
                x={GUTTER_X + c.col * STEP}
                y={GUTTER_Y + c.row * STEP}
                width={CELL}
                height={CELL}
                rx={2}
                onClick={tap}
                onFocus={() => setStopDay(c.day)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    tap();
                    return;
                  }
                  if (e.key === " ") {
                    e.preventDefault();
                    return;
                  }
                  const target = walkTarget(e.key, i, cells.length);
                  if (target !== null) {
                    e.preventDefault();
                    focusCell(target);
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === " ") tap();
                }}
              >
                <title>{`${monthDay(c.day)} · ${c.count} 件${breakdown(c)}`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="heatmap-legend" aria-hidden="true">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <i key={level} className={`l${level}`} />
        ))}
        <span>多</span>
        {/* The two hues, one swatch each, in the caption's order. */}
        <span className="heatmap-legend-kind">
          <i className="in" />
          吸う
        </span>
        <span className="heatmap-legend-kind">
          <i className="out" />
          出す
        </span>
      </div>
    </figure>
  );
}

/**
 * The one 総草. `refreshKey` bumps after a post so today darkens (DoD 4);
 * a tapped cell hands its day to `onDayTap` (the feed's 1-day period).
 */
export function HeatmapSection(props: {
  refreshKey: number;
  onDayTap: (day: string) => void;
  onFault: (e: unknown) => void;
  /** The 年表 view is up: the 総草 belongs to the 投稿一覧 (features.md §3) and waits, mounted. */
  hidden?: boolean;
}) {
  // Refetches replace the data in place — no flicker back to a loading state.
  const [garden, setGarden] = useState<Heatmap | null>(null);

  const { refreshKey, onDayTap, onFault } = props;
  useEffect(() => {
    let cancelled = false;
    getHeatmap()
      .then((g) => {
        if (!cancelled) setGarden(g);
      })
      .catch((e) => {
        if (!cancelled) onFault(e);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, onFault]);

  if (garden === null) return null; // first load: appear when grown
  return (
    <section className="heatmaps" hidden={props.hidden}>
      <h2>苔</h2>
      <HeatmapChart label="総草" data={garden} onDayTap={onDayTap} hidden={props.hidden} />
    </section>
  );
}
