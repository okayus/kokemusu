// Browser side of the stats API. Counts and days only — bodies never ride on
// this endpoint (ADR-0001), so the moss draws even while BODY_KEY is missing.
import { request } from "./api";

/**
 * One cell: the JST day, its 苔片 count, the server-decided 0..4 shade, and how
 * many of the day's 苔片 face each way (`both` counts on both sides) — the
 * cell's hue is decided by comparing the two (visualization.md §1).
 */
export type HeatmapDay = {
  day: string;
  count: number;
  level: number;
  input: number;
  output: number;
};

/**
 * Dense ascending series over the resolved window (default: 53 weeks to today).
 * `total` = the 苔片 overlapping the window — the caption's 計 — which is not the
 * cells' sum once a 続く苔片 lights several days (ADR-0005); `input` / `output`
 * count those same 苔片 by 向き, the caption's 「吸う x% · 出す y%」.
 */
export type Heatmap = {
  from: string;
  to: string;
  total: number;
  input: number;
  output: number;
  days: HeatmapDay[];
};

// No tag parameter on purpose: the heatmap is the 総草 alone (visualization.md
// §1). Per-tag devotion belongs to the graph and the tag timeline (Phase 2).
export const getHeatmap = (): Promise<Heatmap> => request("/api/stats/heatmap");

/**
 * 量 per 活動月: the JST `YYYY-MM` and the 量 of the row's 苔片 in it (ADR-0007:
 * a single day 1, a 続く苔片 that month's days × its 厚み). Sparse — only months
 * with a 苔片 — and ascending; the amounts add up to the row's `amount`.
 */
export type MonthAmount = { month: string; amount: number };

/**
 * One row of the 年表: a tag set, its first/last JST day, the 苔片 count (「N 片」,
 * an honest count), their 量 (a fraction — src/amount.ts formats it), and its
 * 活動月 (the month segments, §8).
 */
export type TimelineRow = {
  tags: { id: string; name: string }[];
  firstDay: string;
  lastDay: string;
  count: number;
  amount: number;
  months: MonthAmount[];
};

/** `today` is server-decided (JST) — it is the axis's right edge in every view. */
export type TagTimeline = { today: string; rows: TimelineRow[] };

/**
 * The three forms of visualization.md §8: no option = one row per tag,
 * `focus` = the 選んだ石 (1+ ids) as one row + set×co-occurring-stone rows,
 * `tags` = the one AND row for a 2+ tag set. Metadata only — bodies never
 * ride here.
 */
export function getTimeline(opts: { focus?: string[]; tags?: string[] } = {}): Promise<TagTimeline> {
  const q = new URLSearchParams();
  if (opts.focus !== undefined) q.set("focus", opts.focus.join(","));
  if (opts.tags !== undefined) q.set("tags", opts.tags.join(","));
  const qs = q.toString();
  return request(`/api/stats/timeline${qs ? `?${qs}` : ""}`);
}

/** A stone in the relationship graph: display bits + the 量 of its 苔片 in the period (ADR-0007, clipped to it). */
export type GraphNode = { id: string; name: string; color: string | null; amount: number };

/** A bridge: the two stones' ids (`a` < `b`) and the 量 of the 苔片 carrying both tags. */
export type GraphEdge = { a: string; b: string; amount: number };

/** The server owns the order: nodes and edges both come 量-descending. */
export type TagGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

/** 今月 / 今年 / 全期間 (visualization.md §6). The boundary is cut server-side in APP_TZ. */
export type GraphPeriod = "month" | "year" | "all";

export function getGraph(period: GraphPeriod): Promise<TagGraph> {
  return request(period === "all" ? "/api/stats/graph" : `/api/stats/graph?period=${period}`);
}
