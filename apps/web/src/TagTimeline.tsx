import { useEffect, useState, type Ref } from "react";
import type { TagSummary } from "./posts-api";
import { getTimeline, type TagTimeline, type TimelineRow } from "./stats-api";

// 石の年表 (docs/visualization.md §8): one horizontal bar per tag set — first
// 苔片 to last 苔片 — sorted by start day so it reads as a 年表. Tapping a
// stone focuses it (その石のみ + 石×共起タグ, the 内訳年表); adding a chip to a
// focused row drills into 3+ tag AND rows, ad-hoc and never saved. Hand-written
// SVG like the 総草; the server owns the aggregation and "today", the client
// only draws. Bars are position-encoded, so all wear the one moss accent —
// identity lives in the row's chips, not in color.

// ---------------------------------------------------------------- pure layout

const MS_PER_DAY = 86_400_000;

/** Days since the epoch of a `YYYY-MM-DD` key — the UTC carrier for civil math, same trick as worker/core/day.ts. */
const dayIndex = (day: string) =>
  Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / MS_PER_DAY;

/** The shared x-axis of every bar: [first 苔片 of any row, today]. */
export type Domain = { from: string; to: string };

export type Span = { firstDay: string; lastDay: string; count: number };

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
export function barGeom(span: Span, domain: Domain): { x: number; w: number } {
  const total = dayIndex(domain.to) - dayIndex(domain.from) + 1;
  let x = ((dayIndex(span.firstDay) - dayIndex(domain.from)) / total) * 100;
  let w = ((dayIndex(span.lastDay) - dayIndex(span.firstDay) + 1) / total) * 100;
  if (w < MIN_BAR_PCT) w = MIN_BAR_PCT;
  if (x + w > 100) x = 100 - w;
  return { x: round3(x), w: round3(w) };
}

export type AxisTick = { x: number; label: string };

/** Domains up to ~13 months tick by month; wider ones by year. */
const MONTH_TICKS_MAX_DAYS = 400;
/** More labels than this and they collide: thin, keeping the most recent. */
const MAX_TICKS = 8;
/** The right edge belongs to the 今日 label — drop ticks that would sit under it. */
const TICK_MAX_X = 92;

export function axisTicks(domain: Domain): AxisTick[] {
  const total = dayIndex(domain.to) - dayIndex(domain.from) + 1;
  const monthly = total <= MONTH_TICKS_MAX_DAYS;
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
  const ticks: AxisTick[] = [];
  for (;;) {
    const day = `${y}-${String(m).padStart(2, "0")}-01`;
    if (day > domain.to) break;
    if (monthly || m === 1) {
      const x = round3(((dayIndex(day) - dayIndex(domain.from)) / total) * 100);
      // A January tick names the year in both modes — that is the 年表's spine.
      if (x <= TICK_MAX_X) ticks.push({ x, label: m === 1 ? `${y}年` : `${m}月` });
    }
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  if (ticks.length <= MAX_TICKS) return ticks;
  // Thin from the END so the recent years always keep their labels.
  const step = Math.ceil(ticks.length / MAX_TICKS);
  return ticks.filter((_, i) => (ticks.length - 1 - i) % step === 0);
}

/** 「N 片 · d日/片」 — count plus density (期間 ÷ 件数), the "細く長く vs 太く短く" discriminator. */
export function rowNote(span: Span): string {
  const days = dayIndex(span.lastDay) - dayIndex(span.firstDay) + 1;
  const per = days / span.count;
  const density = per >= 10 ? String(Math.round(per)) : per.toFixed(1);
  return `${span.count} 片 · ${density}日/片`;
}

/** Hover / accessible description of a bar: the period and the count. */
export function spanTitle(span: Span): string {
  const period =
    span.firstDay === span.lastDay ? span.firstDay : `${span.firstDay} 〜 ${span.lastDay}`;
  return `${period} · ${span.count} 片`;
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
    span: { firstDay: r.firstDay, lastDay: r.lastDay, count: r.count },
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
      {/* Decorative: every tick fact is recoverable from the bars' own labels. */}
      <svg className="tl-axis" aria-hidden="true">
        {axisTicks(domain).map((t) => (
          <text key={t.x} x={`${t.x}%`} y="10">
            {t.label}
          </text>
        ))}
        <text x="100%" y="10" textAnchor="end">
          今日
        </text>
      </svg>
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
    </div>
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
      <span className="tl-note">{row.span !== null ? rowNote(row.span) : row.loading ? "" : "0 片"}</span>
    </li>
  );
}

function TimelineBar(props: { span: Span; domain: Domain }) {
  const { x, w } = barGeom(props.span, props.domain);
  const title = spanTitle(props.span);
  return (
    <svg className="tl-bar" role="img" aria-label={title}>
      <line className="tl-track" x1="0" x2="100%" y1="8" y2="8" />
      {/* A range bar: both ends are data ends, so both wear the 4px rounding. */}
      <rect className="tl-span" x={`${x}%`} y="3" width={`${w}%`} height="10" rx="4">
        <title>{title}</title>
      </rect>
    </svg>
  );
}

// --------------------------------------------------------------- the section

/**
 * Data + view state around the chart. `refreshKey` bumps after a post so a
 * fresh 苔片 stretches its stones' bars right away, same as the 総草. The
 * focused stone is the page's state, not this section's — the graph's stone
 * taps land here too (§6 → §8) — so it arrives as a controlled prop.
 */
export function TagTimelineSection(props: {
  refreshKey: number;
  tagOptions: TagSummary[];
  focusTag: TagSummary | null;
  onFocusChange: (tag: TagSummary | null) => void;
  /** 投稿一覧へ (visualization.md §8): land the post list's filter on the focused stone. */
  onShowPosts: (tag: TagSummary) => void;
  onFault: (e: unknown) => void;
  /** Lets the page scroll the 年表 into view when a stone is tapped elsewhere. */
  ref?: Ref<HTMLElement>;
}) {
  const [data, setData] = useState<TagTimeline | null>(null);
  const [adhoc, setAdhoc] = useState<AdhocEntry[]>([]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const { refreshKey, onFault, focusTag } = props;
  const focusId = focusTag === null ? null : focusTag.id;

  // The focus moved (a chip here, a stone in the graph, すべての石へ): drop the
  // view-local state before this render's output, so the old view's rows never
  // sit under the new heading (the adjust-state-while-rendering pattern).
  const [shownFocusId, setShownFocusId] = useState(focusId);
  if (shownFocusId !== focusId) {
    setShownFocusId(focusId);
    setData(null);
    setAdhoc([]);
    setPickerFor(null);
    setPickError(null);
  }

  useEffect(() => {
    let cancelled = false;
    getTimeline(focusId === null ? {} : { focus: focusId })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) onFault(e);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, focusId, onFault]);

  const focusOn = (t: TagSummary) => {
    if (focusId !== t.id) props.onFocusChange(t);
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
          ? {
              ...a,
              loading: false,
              span:
                found === null
                  ? null
                  : { firstDay: found.firstDay, lastDay: found.lastDay, count: found.count },
            }
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

  // Until the first tagged 苔片 exists there is no 年表 — appear when grown,
  // like the 総草 (null also covers the very first load).
  if (focusTag === null && (data === null || data.rows.length === 0)) return null;

  const rows = data === null ? [] : assembleRows(data.rows, adhoc);
  return (
    <section className="tag-timeline" ref={props.ref}>
      <div className="tl-head">
        <h2>年表</h2>
        {focusTag !== null && (
          <p className="tl-focus">
            <span>「{focusTag.name}」の内訳</span>
            <button type="button" onClick={() => props.onShowPosts(focusTag)}>
              投稿一覧へ
            </button>
            <button type="button" onClick={() => props.onFocusChange(null)}>
              すべての石へ
            </button>
          </p>
        )}
      </div>
      {data === null ? (
        <p className="quiet">…</p>
      ) : rows.length === 0 ? (
        <p className="quiet">この石の苔片はもうありません。</p>
      ) : (
        <TimelineChart
          rows={rows}
          today={data.today}
          onTagTap={focusOn}
          deepDive={
            focusTag === null
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
