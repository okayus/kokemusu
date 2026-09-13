import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import { formatAmount, formatMeasured, formatThickness, measuredThickness } from "./amount";
import type { TagSummary } from "./posts-api";
import { getTimeline, type MonthAmount, type TagTimeline, type TimelineRow } from "./stats-api";

// 石の年表 (docs/visualization.md §8): one horizontal bar per tag set — first
// 苔片 to last 苔片 — sorted by start day so it reads as a 年表. Tapping a
// stone focuses it (その石のみ + 石×共起タグ, the 内訳年表); adding a chip to a
// focused row drills into 3+ tag AND rows, ad-hoc and never saved. Hand-written
// SVG like the 総草; the server owns the aggregation and "today", the client
// only draws. Bars are position-encoded and all wear the one moss hue —
// identity lives in the row's chips, not in color. What the hue's steps and
// the bar's height carry is the 量 and the 厚み (ADR-0007): 太さ ＝ 量, 濃さ ＝
// 厚み per 活動月 on the 総草's ramp, and the numbers themselves wait in a
// popover that hover or a tap on the bar opens (§8).

// ---------------------------------------------------------------- pure layout

const MS_PER_DAY = 86_400_000;

/** Days since the epoch of a `YYYY-MM-DD` key — the UTC carrier for civil math, same trick as worker/core/day.ts. */
const dayIndex = (day: string) =>
  Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / MS_PER_DAY;

/** The shared x-axis of every bar: [first 苔片 of any row, today]. */
export type Domain = { from: string; to: string };

/** A day range, first and last inclusive — all the bar geometry needs. */
export type DayRange = { firstDay: string; lastDay: string };

/** The days a range covers, both ends counted — the 厚み's denominator. */
const daysOf = (range: DayRange) => dayIndex(range.lastDay) - dayIndex(range.firstDay) + 1;

/** A row's data: the range, the 苔片 count, their 量 (ADR-0007), and its 活動月 by 量 — the month segments (§8). */
export type Span = DayRange & { count: number; amount: number; months: MonthAmount[] };

/** A row on the wire → the chart's span. */
export const toSpan = (r: TimelineRow): Span => ({
  firstDay: r.firstDay,
  lastDay: r.lastDay,
  count: r.count,
  amount: r.amount,
  months: r.months,
});

/** One drawn row. `span: null` = the set overlaps on no 苔片 (empty AND row). */
export type ChartRow = {
  key: string;
  tags: TagSummary[];
  span: Span | null;
  loading?: boolean;
  adhoc?: boolean;
};

export function chartDomain(rows: ChartRow[], today: string): Domain {
  let from = today;
  for (const r of rows) {
    if (r.span !== null && r.span.firstDay < from) from = r.span.firstDay;
  }
  return { from, to: today };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** A one-day stone on a years-long axis must stay a visible dot: floor the width. */
const MIN_BAR_PCT = 1.2;

/**
 * Bar position as percentages of the domain, days as the unit (a bar covers
 * its last day fully — first and last day inclusive). Clamped: never thinner
 * than MIN_BAR_PCT, never past the right edge.
 */
export function barGeom(range: DayRange, domain: Domain): { x: number; w: number } {
  const total = dayIndex(domain.to) - dayIndex(domain.from) + 1;
  let x = ((dayIndex(range.firstDay) - dayIndex(domain.from)) / total) * 100;
  let w = ((dayIndex(range.lastDay) - dayIndex(range.firstDay) + 1) / total) * 100;
  if (w < MIN_BAR_PCT) w = MIN_BAR_PCT;
  if (x + w > 100) x = 100 - w;
  return { x: round3(x), w: round3(w) };
}

/** Months since year 0 of a day key — the unit for "how many months does a span cross". */
const monthIndex = (day: string) => +day.slice(0, 4) * 12 + (+day.slice(5, 7) - 1);

/** First / last day of a `YYYY-MM` month; the last via `Date.UTC(y, m, 0)` = day 0 of the next month. */
const monthFirstDay = (month: string) => `${month}-01`;
const monthLastDay = (month: string) => {
  const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
};

/** A drawn 活動月: its geometry and the 厚み measured over the days it covers on the bar. */
export type MonthSegment = MonthAmount & { x: number; w: number; thickness: number };

/**
 * The month segments of a bar (visualization.md §8): one per 活動月, each cut
 * to the span — the first and last are partial months, so the segments' extent
 * is the span's and the bar never grows past its first or last 苔片. A month
 * outside the span cannot come from the server (a row's months lie within its
 * MIN/MAX) and is skipped rather than drawn off the bar. Geometry is barGeom's,
 * floor included, so an isolated month stays a visible dot on a years-long
 * axis; where the floor pushes a segment past the era bar's end, the SVG clips.
 * The 厚み is the month's 量 over the days the cut covers, so a first month
 * entered on its 20th is as dark as the full months that follow it.
 */
export function monthSegments(span: Span, domain: Domain): MonthSegment[] {
  const segments: MonthSegment[] = [];
  for (const m of span.months) {
    const first = monthFirstDay(m.month);
    const last = monthLastDay(m.month);
    const firstDay = first < span.firstDay ? span.firstDay : first;
    const lastDay = last > span.lastDay ? span.lastDay : last;
    if (lastDay < firstDay) continue;
    const cut = { firstDay, lastDay };
    segments.push({
      ...m,
      ...barGeom(cut, domain),
      thickness: measuredThickness(m.amount, daysOf(cut)),
    });
  }
  return segments;
}

/** The segment under a point of the lane (a percentage of the axis, as x and w are) — the tip's month line. */
export function segmentAt(segments: readonly MonthSegment[], pct: number): MonthSegment | null {
  for (const s of segments) {
    if (pct >= s.x && pct <= s.x + s.w) return s;
  }
  return null;
}

/** The lane's height in px; the bar sits centred on the track at half of it. */
export const BAR_H = 20;

// 太さ ＝ 量 (CONTEXT.md 量: 「年表の太さはこれを読み」): the bar's height grows
// with the square root of the row's 量 from a floor and caps — the graph's
// nodeRadius law, so a stone and its row swell on the same terms. One 苔片
// (量 1) is 4px, a month of every day (量 30) 10px; the 15px cap is reached
// at 量 100, three months and a bit of every day.
const H_MIN = 3;
const H_GROW = 1.2;
const H_MAX = 15;

/** The bar's height in whole px for a row's 量. */
export const barThickness = (amount: number) =>
  Math.round(Math.min(H_MAX, H_MIN + H_GROW * Math.sqrt(amount)));

/**
 * 濃さ ＝ 厚み: the four steps of moss the 総草 paints with (--moss-1 … 4) on a
 * 厚み measured over some days — たまに (up to a day in five), 半分まで, ほぼ毎日,
 * and 毎日以上 (1 is the slider's 毎日; several 苔片 a day sit on the same
 * step, as the 総草's 4+ do). A dormant month wears --moss-0, the empty cell.
 */
export function thicknessLevel(thickness: number): 1 | 2 | 3 | 4 {
  if (thickness >= 1) return 4;
  if (thickness > 0.5) return 3;
  if (thickness > 0.2) return 2;
  return 1;
}

export type AxisTick = { x: number; label: string };

/** Domains up to ~13 months tick by month; wider ones by year. */
const MONTH_TICKS_MAX_DAYS = 400;
/**
 * Tick intervals in months, calendar-aligned: a month boundary survives at
 * interval k when its month index (year × 12 + month) is a multiple of k —
 * 1・3・6 か月, then 1・2・5・10・20・50 年. Round years (2020, 2025) are how a
 * 年表's spine reads; counting back from the newest tick would drift with today.
 */
const TICK_LADDER = [1, 3, 6, 12, 24, 60, 120, 240, 600];
/**
 * Label widths at `.tl-axis text`'s 9px: a CJK glyph is its em (9px); a digit
 * runs 4.5–5.7px across system-ui fonts (Yu Gothic UI · Segoe · SF · Roboto ·
 * Noto Sans · DejaVu), so lean towards the wide end — a too-wide estimate
 * thins one step early at a boundary, a too-narrow one eats the air between
 * neighbours. An estimate, not a measurement: the labels are digits + 年 / 月 /
 * 今日 only, and measuring would mean rendering before deciding what to render.
 */
const DIGIT_PX = 5.5;
const GLYPH_PX = 9;
const LABEL_GAP_PX = 8;
const TODAY_LABEL = "今日";

export function labelPx(label: string): number {
  let px = 0;
  for (const ch of label) px += ch >= "0" && ch <= "9" ? DIGIT_PX : GLYPH_PX;
  return px;
}

/** Left edge of a tick's label, in px, on an axis `axisPx` wide (labels are start-anchored at x). */
const labelLeft = (tick: AxisTick, axisPx: number) => (tick.x / 100) * axisPx;

/** True when no label runs into the one after it. */
const labelsClear = (ticks: readonly AxisTick[], axisPx: number) =>
  ticks.every((tick, i) => {
    const prev = ticks[i - 1];
    return (
      prev === undefined ||
      labelLeft(prev, axisPx) + labelPx(prev.label) + LABEL_GAP_PX <= labelLeft(tick, axisPx)
    );
  });

/**
 * The axis labels for an axis `axisPx` CSS pixels wide. Every month boundary
 * in the domain is a candidate (a January wears its year in both modes — that
 * is the 年表's spine). 今日 owns the right edge, so a label that would run
 * into it yields; then the ladder coarsens the interval until no label runs
 * into its neighbour. An unknown width (0) leaves only 今日.
 */
export function axisTicks(domain: Domain, axisPx: number): AxisTick[] {
  const total = dayIndex(domain.to) - dayIndex(domain.from) + 1;
  const finest = total <= MONTH_TICKS_MAX_DAYS ? 1 : 12;
  const todayLeft = axisPx - labelPx(TODAY_LABEL) - LABEL_GAP_PX;
  // Walk the 1sts from the first month boundary at or after `from`.
  let y = +domain.from.slice(0, 4);
  let m = +domain.from.slice(5, 7);
  if (domain.from.slice(8, 10) !== "01") {
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  const candidates: (AxisTick & { month: number })[] = [];
  for (;;) {
    const day = `${y}-${String(m).padStart(2, "0")}-01`;
    if (day > domain.to) break;
    const x = round3(((dayIndex(day) - dayIndex(domain.from)) / total) * 100);
    const label = m === 1 ? `${y}年` : `${m}月`;
    if ((x / 100) * axisPx + labelPx(label) <= todayLeft) {
      candidates.push({ x, label, month: monthIndex(day) });
    }
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  for (const interval of TICK_LADDER) {
    if (interval < finest) continue;
    const kept = candidates.filter((t) => t.month % interval === 0);
    if (labelsClear(kept, axisPx)) return kept.map(({ x, label }) => ({ x, label }));
  }
  return [];
}

/**
 * 「量 N · 厚み x%」 (visualization.md §8, ADR-0007): the row's 量 and the 厚み
 * measured over its period — 量 ÷ days, the same word a 続く苔片 declares its
 * own in — the "細く長く vs 太く短く" discriminator. Several 苔片 on a day put
 * it past 100%, and it is shown so. The tip's first line and the tail of the
 * bar's label; the count stays in spanTitle.
 */
export function rowNote(span: Span): string {
  return `量 ${formatAmount(span.amount)} · 厚み ${formatThickness(span.amount, daysOf(span))}`;
}

/**
 * The bar's period line: the period, the count, and — once the span crosses
 * a month — how many of its months saw a 苔片, which is what the segments
 * show and the only place a screen reader hears it.
 */
export function spanTitle(span: Span): string {
  const period =
    span.firstDay === span.lastDay ? span.firstDay : `${span.firstDay} 〜 ${span.lastDay}`;
  const base = `${period} · ${span.count} 片`;
  const crossed = monthIndex(span.lastDay) - monthIndex(span.firstDay) + 1;
  return crossed > 1 ? `${base} · 活動 ${span.months.length}/${crossed} か月` : base;
}

/** The tip's month line: the 活動月 under the pointer, its 量 and its own 厚み. */
export function monthTitle(s: Pick<MonthSegment, "month" | "amount" | "thickness">): string {
  return `${s.month} · 量 ${formatAmount(s.amount)} · 厚み ${formatMeasured(s.thickness)}`;
}

// ------------------------------------------------- rows = server + ad-hoc mix

/** An ad-hoc deep-dive row: lives only in this view, slotted after its origin. */
export type AdhocEntry = {
  key: string;
  afterKey: string;
  tags: TagSummary[];
  span: Span | null;
  loading: boolean;
};

export const rowKey = (tags: readonly TagSummary[]) => tags.map((t) => t.id).join("+");

/**
 * Interleave: server rows in server order, each ad-hoc row right below the row
 * it was derived from (chains nest). An orphaned anchor (base refetched after
 * a post) falls to the end rather than vanishing.
 */
export function assembleRows(base: TimelineRow[], adhoc: readonly AdhocEntry[]): ChartRow[] {
  const rows: ChartRow[] = base.map((r) => ({
    key: rowKey(r.tags),
    tags: r.tags,
    span: toSpan(r),
  }));
  for (const a of adhoc) {
    const i = rows.findIndex((r) => r.key === a.afterKey);
    const row: ChartRow = { key: a.key, tags: a.tags, span: a.span, loading: a.loading, adhoc: true };
    rows.splice(i === -1 ? rows.length : i + 1, 0, row);
  }
  return rows;
}

// ----------------------------------------------------------------- the chart

/** Focus-mode extras: the deep-dive picker and ad-hoc row controls. */
type DeepDive = {
  options: TagSummary[];
  openFor: string | null;
  error: string | null;
  onToggle: (key: string | null) => void;
  onPick: (row: ChartRow, raw: string) => void;
  onRemove: (key: string) => void;
};

// Exported for the markup test — geometry and structure are locked there, the
// same arrangement as HeatmapChart (no in-sandbox browser to eyeball it).
export function TimelineChart(props: {
  rows: ChartRow[];
  today: string;
  onTagTap: (tag: TagSummary) => void;
  deepDive?: DeepDive | undefined;
}) {
  const domain = chartDomain(props.rows, props.today);
  return (
    <div className="tl-grid">
      <TimelineAxis domain={domain} />
      {/* role="list": list-style is stripped for the grid, Safari drops list semantics without it. */}
      <ol className="tl-rows" role="list">
        {props.rows.map((row) => (
          <TimelineRowItem
            key={row.key}
            row={row}
            domain={domain}
            onTagTap={props.onTagTap}
            deepDive={props.deepDive}
          />
        ))}
      </ol>
      {props.deepDive && (
        <datalist id="tl-tag-options">
          {props.deepDive.options.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
      )}
      {/* What the bars wear, in the 総草's words: the height is the 量, the
          shade the 厚み (four steps, --moss-1 … 4; a dormant month --moss-0).
          Decorative — every number is in the bar's label and its tip. */}
      <div className="tl-legend" aria-hidden="true">
        <span className="tl-legend-item">太さ ＝ 量</span>
        <span className="tl-legend-item">
          濃さ ＝ 厚み
          {[1, 2, 3, 4].map((level) => (
            <i key={level} className={`l${level}`} />
          ))}
        </span>
      </div>
    </div>
  );
}

/**
 * Before the first measurement — and in static markup, where no layout runs —
 * the axis is laid out for this width, a typical desktop bar column.
 */
const AXIS_NOMINAL_PX = 320;

/**
 * Decorative (every tick fact is recoverable from the bars' own labels), and
 * measured rather than styled: how many labels fit is a function of the
 * column's pixel width, which only the browser knows (subgrid column, chip
 * widths, viewport), and no container query can count labels. useLayoutEffect
 * so the first paint already wears the measured set; a ResizeObserver for
 * every later change (viewport, a picker form widening the chip column).
 */
function TimelineAxis(props: { domain: Domain }) {
  const ref = useRef<SVGSVGElement>(null);
  const [axisPx, setAxisPx] = useState(AXIS_NOMINAL_PX);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => setAxisPx(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <svg ref={ref} className="tl-axis" aria-hidden="true">
      {axisTicks(props.domain, axisPx).map((t) => (
        <text key={t.x} x={`${t.x}%`} y="10">
          {t.label}
        </text>
      ))}
      <text x="100%" y="10" textAnchor="end">
        {TODAY_LABEL}
      </text>
    </svg>
  );
}

function TimelineRowItem(props: {
  row: ChartRow;
  domain: Domain;
  onTagTap: (tag: TagSummary) => void;
  deepDive?: DeepDive | undefined;
}) {
  const { row, domain, deepDive } = props;
  const label = row.tags.map((t) => t.name).join(" × ");
  const pickerOpen = deepDive !== undefined && deepDive.openFor === row.key;
  return (
    <li className={row.adhoc ? "tl-row adhoc" : "tl-row"}>
      <span className="tl-tags">
        {row.tags.map((t) => (
          <button
            key={t.id}
            type="button"
            className="tag-chip"
            onClick={() => props.onTagTap(t)}
          >
            {t.name}
          </button>
        ))}
        {deepDive && !pickerOpen && (
          <button
            type="button"
            className="tl-add"
            aria-label={`${label} に石を足して深掘り`}
            onClick={() => deepDive.onToggle(row.key)}
          >
            ＋
          </button>
        )}
        {deepDive && row.adhoc && !row.loading && (
          <button
            type="button"
            className="tl-remove"
            aria-label={`${label} の行を消す`}
            onClick={() => deepDive.onRemove(row.key)}
          >
            ×
          </button>
        )}
        {pickerOpen && (
          <form
            className="tl-picker"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              deepDive.onPick(row, String(fd.get("chip") ?? ""));
            }}
          >
            <input
              name="chip"
              list="tl-tag-options"
              autoComplete="off"
              maxLength={100}
              placeholder="石の名前"
              aria-label={`${label} に足す石`}
              // The form appears on explicit request (＋), so focus follows the intent.
              autoFocus
            />
            <button type="submit">足す</button>
            <button type="button" aria-label="足すのをやめる" onClick={() => deepDive.onToggle(null)}>
              ×
            </button>
          </form>
        )}
        {pickerOpen && deepDive.error !== null && (
          <span role="alert" className="tl-pick-error">
            {deepDive.error}
          </span>
        )}
      </span>
      {row.loading ? (
        <span className="tl-empty quiet">…</span>
      ) : row.span === null ? (
        <span className="tl-empty quiet">重なる苔片なし</span>
      ) : (
        <TimelineBar span={row.span} domain={domain} />
      )}
    </li>
  );
}

// Interest invokers (hover or focus opens the tip, a long press on touch) are
// Chrome's for now (142+). Where the attribute is unknown, a mouse and the
// keyboard get the same from a few handlers, and touch keeps popovertarget's
// native tap toggle either way.
const HAS_INTEREST =
  typeof HTMLButtonElement !== "undefined" && "interestForElement" in HTMLButtonElement.prototype;

/**
 * One bar: the era drawn in SVG, a transparent button laid over it as the hit
 * target (the anchor of the tip and the 28px thumb target a 1-day dot lacks),
 * and the tip — a popover with the numbers the bar encodes, opened by hover
 * (interest) or a tap (popovertarget), dismissed by Escape or a tap outside.
 */
function TimelineBar(props: { span: Span; domain: Domain }) {
  const { span, domain } = props;
  const { x, w } = barGeom(span, domain);
  const h = barThickness(span.amount);
  const y = (BAR_H - h) / 2;
  const segments = monthSegments(span, domain);
  // <clipPath> and popover ids are document-wide; one bar per row, so one id each.
  const id = useId();
  const clipId = `${id}c`;
  const tipId = `${id}t`;
  // The tip anchors to its own button by a name of the row's own: a name all
  // rows shared would resolve, for a popover in the top layer, to the LAST
  // such element in the document — everything in flow is laid out before
  // the top layer, so "the last acceptable anchor" is the last row's.
  const anchor = `--tl-${id.replace(/[^\w-]/g, "-")}`;
  const tipRef = useRef<HTMLDivElement>(null);
  // Whether the tip is open, kept from beforetoggle (synchronous, unlike
  // toggle) so the fallback never calls showPopover on an open one.
  const openRef = useRef(false);
  // The 活動月 under the last pointer, as its key: a pointer moving within one
  // segment sets the same string and re-renders nothing.
  const [monthAt, setMonthAt] = useState<string | null>(null);
  const locate = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    // The button covers the era, so the pointer's fraction of it is the era's — back onto the axis.
    setMonthAt(segmentAt(segments, x + ((e.clientX - box.left) / box.width) * w)?.month ?? null);
  };
  const setOpen = (open: boolean) => {
    const tip = tipRef.current;
    if (tip === null || openRef.current === open) return;
    if (open) tip.showPopover();
    else tip.hidePopover();
  };
  const title = spanTitle(span);
  const note = rowNote(span);
  const month = monthAt === null ? null : (segments.find((s) => s.month === monthAt) ?? null);
  return (
    // The tip is a descendant of the lane, so a mouse crossing from the
    // button into the tip never leaves it (the fallback's hide is the lane's).
    <span
      className="tl-lane"
      style={{ "--tl-anchor": anchor } as CSSProperties}
      onPointerLeave={
        HAS_INTEREST
          ? undefined
          : (e) => {
              if (e.pointerType === "mouse") setOpen(false);
            }
      }
    >
      <svg className="tl-bar" aria-hidden="true">
        <line className="tl-track" x1="0" x2="100%" y1={BAR_H / 2} y2={BAR_H / 2} />
        {/* The era, first 苔片 to last, as the underlay — the 総草's empty
            cell: both ends are data ends, so both wear the 4px rounding. A
            dormant month shows only this. Its height is the row's 量. */}
        <rect className="tl-span" x={`${x}%`} y={y} width={`${w}%`} height={h} rx="4" />
        {/* The 活動月, each on its step of moss by its own 厚み, cut to the
            era's rounded outline: a run's outer corners match the underlay
            while the cut between two runs stays square — the gap is the
            point (§8). */}
        <clipPath id={clipId}>
          <rect x={`${x}%`} y={y} width={`${w}%`} height={h} rx="4" />
        </clipPath>
        <g clipPath={`url(#${clipId})`}>
          {segments.map((s) => (
            <rect
              key={s.month}
              className={`tl-month l${thicknessLevel(s.thickness)}`}
              x={`${s.x}%`}
              y={y}
              width={`${s.w}%`}
              height={h}
            />
          ))}
        </g>
      </svg>
      <button
        type="button"
        className="tl-hit"
        style={{ insetInlineStart: `${x}%`, inlineSize: `${w}%` }}
        popoverTarget={tipId}
        {...{ interestfor: tipId }}
        aria-label={`${title} · ${note}`}
        onPointerDown={locate}
        onPointerMove={locate}
        onPointerEnter={
          HAS_INTEREST
            ? undefined
            : (e) => {
                if (e.pointerType === "mouse") setOpen(true);
              }
        }
        // Keyboard focus opens the tip as interest would; a tap's focus must
        // not, or the toggle that follows it would close what focus opened.
        onFocus={
          HAS_INTEREST
            ? undefined
            : (e) => {
                if (e.currentTarget.matches(":focus-visible")) setOpen(true);
              }
        }
        onBlur={HAS_INTEREST ? undefined : () => setOpen(false)}
      />
      <div
        id={tipId}
        popover="auto"
        className="tl-tip"
        ref={tipRef}
        onBeforeToggle={(e) => {
          openRef.current = e.newState === "open";
        }}
      >
        <strong>{note}</strong>
        <span>{title}</span>
        {month !== null && segments.length > 1 && <span>{monthTitle(month)}</span>}
      </div>
    </span>
  );
}

// --------------------------------------------------------------- the section

/**
 * Data + view state around the chart. `refreshKey` bumps after a post so a
 * fresh 苔片 stretches its stones' bars right away, same as the 総草. The axis
 * — the 選んだ石 (features.md §3) — is the page's state, not this section's:
 * the graph's taps write it and the 投稿一覧 reads the same set, so it arrives
 * as a controlled prop. Empty = every stone, one row each; one or more = that
 * set's 内訳 (visualization.md §8: the set itself, then set × each
 * co-occurring stone).
 */
export function TagTimelineSection(props: {
  refreshKey: number;
  tagOptions: TagSummary[];
  /** The 選んだ石 — the axis. */
  focus: readonly TagSummary[];
  /** Replace the 選んだ石: a row's chip means that one stone, すべての石へ means none. */
  onFocusChange: (tags: TagSummary[]) => void;
  /** 投稿一覧へ (visualization.md §8): the same stones already filter the feed, so this only travels. */
  onShowPosts: () => void;
  onFault: (e: unknown) => void;
  /** The other view is up: stay mounted — the axis and its rows are kept — but out of the page. */
  hidden?: boolean;
  /** Lets the page scroll the 年表 into view. */
  ref?: Ref<HTMLElement>;
}) {
  const [data, setData] = useState<TagTimeline | null>(null);
  const [adhoc, setAdhoc] = useState<AdhocEntry[]>([]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const { refreshKey, onFault, focus } = props;
  const focusKey = rowKey(focus);
  const focusIds = focus.map((t) => t.id);

  // The axis moved (a chip here, a stone in the graph, すべての石へ): drop the
  // view-local state before this render's output, so the old axis's rows never
  // sit under the new heading (the adjust-state-while-rendering pattern).
  const [shownFocusKey, setShownFocusKey] = useState(focusKey);
  if (shownFocusKey !== focusKey) {
    setShownFocusKey(focusKey);
    setData(null);
    setAdhoc([]);
    setPickerFor(null);
    setPickError(null);
  }

  useEffect(() => {
    let cancelled = false;
    // Keyed on the ids' key, not the array: the same stones in a new array
    // must not refetch. The effect only runs when the key changed, and then
    // it is this render's closure, so focusIds is current.
    getTimeline(focusIds.length === 0 ? {} : { focus: focusIds })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) onFault(e);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, focusKey, onFault]);

  // A row's chip names one stone: the axis becomes that stone alone (a 導線,
  // not a toggle — the toggling is the graph's, features.md §3).
  const focusOn = (t: TagSummary) => {
    if (!(focus.length === 1 && focus[0]?.id === t.id)) props.onFocusChange([t]);
  };

  const addChip = async (row: ChartRow, raw: string) => {
    // The same fold as the server's normalizeTagName, so any spelling of an
    // existing stone lands on it; the datalist makes the exact path the default.
    const norm = raw.normalize("NFKC").trim().toLowerCase();
    const hit = props.tagOptions.find((t) => t.name.normalize("NFKC").trim().toLowerCase() === norm);
    if (norm === "" || hit === undefined) {
      setPickError("その名前の石はまだ生えていません。");
      return;
    }
    if (row.tags.some((t) => t.id === hit.id)) {
      setPickError("その石はもうこの行にあります。");
      return;
    }
    const tags = [...row.tags, hit];
    const key = rowKey(tags);
    setPickerFor(null);
    setPickError(null);
    // Already drawn (as a server row or an earlier deep dive): nothing to add.
    const shown = data === null ? [] : assembleRows(data.rows, adhoc);
    if (shown.some((r) => r.key === key)) return;
    setAdhoc((list) => [...list, { key, afterKey: row.key, tags, span: null, loading: true }]);
    try {
      const res = await getTimeline({ tags: tags.map((t) => t.id) });
      const found = res.rows[0];
      setAdhocSpan(key, found === undefined ? null : found);
    } catch (e) {
      setAdhoc((list) => list.filter((a) => a.key !== key));
      onFault(e);
    }
  };
  const setAdhocSpan = (key: string, found: TimelineRow | null) => {
    setAdhoc((list) =>
      list.map((a) =>
        a.key === key
          ? { ...a, loading: false, span: found === null ? null : toSpan(found) }
          : a,
      ),
    );
  };
  const removeAdhoc = (key: string) => {
    // A removed row takes its own deep-dive chain with it.
    setAdhoc((list) => {
      const dead = new Set([key]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const a of list) {
          if (!dead.has(a.key) && dead.has(a.afterKey)) {
            dead.add(a.key);
            grew = true;
          }
        }
      }
      return list.filter((a) => !dead.has(a.key));
    });
  };

  // The 年表 is a view of its own now (features.md §3), so an empty garden
  // gets words rather than a missing section — the 総草 still appears only
  // when grown, but that one sits in the other view.
  const rows = data === null ? [] : assembleRows(data.rows, adhoc);
  const focused = focus.length > 0;
  return (
    <section className="tag-timeline" ref={props.ref} hidden={props.hidden}>
      <div className="tl-head">
        <h2>年表</h2>
        {focused && (
          <p className="tl-focus">
            <span>「{focus.map((t) => t.name).join(" × ")}」の内訳</span>
            <button type="button" onClick={props.onShowPosts}>
              投稿一覧へ
            </button>
            <button type="button" onClick={() => props.onFocusChange([])}>
              すべての石へ
            </button>
          </p>
        )}
      </div>
      {data === null ? (
        <p className="quiet">…</p>
      ) : rows.length === 0 ? (
        <p className="quiet">
          {!focused
            ? "まだ石がありません。苔片にタグを付けると、ここに年表が育ちます。"
            : focus.length === 1
              ? "この石の苔片はもうありません。"
              : "この石を全部持つ苔片はありません。"}
        </p>
      ) : (
        <TimelineChart
          rows={rows}
          today={data.today}
          onTagTap={focusOn}
          deepDive={
            !focused
              ? undefined
              : {
                  options: props.tagOptions,
                  openFor: pickerFor,
                  error: pickError,
                  onToggle: (key) => {
                    setPickerFor(key);
                    setPickError(null);
                  },
                  onPick: (row, raw) => void addChip(row, raw),
                  onRemove: removeAdhoc,
                }
          }
        />
      )}
    </section>
  );
}
