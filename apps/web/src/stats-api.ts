// Browser side of the stats API. Counts and days only — bodies never ride on
// this endpoint (ADR-0001), so the moss draws even while BODY_KEY is missing.
import { request } from "./api";

/** One cell: the JST day, its 苔片 count, and the server-decided 0..4 shade. */
export type HeatmapDay = { day: string; count: number; level: number };

/** Dense ascending series over the resolved window (default: 53 weeks to today). */
export type Heatmap = { from: string; to: string; days: HeatmapDay[] };

// No tag parameter on purpose: the heatmap is the 総草 alone (visualization.md
// §1). Per-tag devotion belongs to the graph and the tag timeline (Phase 2).
export const getHeatmap = (): Promise<Heatmap> => request("/api/stats/heatmap");

/** One row of the 年表: a tag set, its first/last JST day, and the 苔片 count. */
export type TimelineRow = {
  tags: { id: string; name: string }[];
  firstDay: string;
  lastDay: string;
  count: number;
};

/** `today` is server-decided (JST) — it is the axis's right edge in every view. */
export type TagTimeline = { today: string; rows: TimelineRow[] };

/**
 * The three forms of visualization.md §8: no option = one row per tag,
 * `focus` = that stone + stone×co-occurring-tag rows, `tags` = the one
 * AND row for a 2+ tag set. Metadata only — bodies never ride here.
 */
export function getTimeline(opts: { focus?: string; tags?: string[] } = {}): Promise<TagTimeline> {
  const q = new URLSearchParams();
  if (opts.focus !== undefined) q.set("focus", opts.focus);
  if (opts.tags !== undefined) q.set("tags", opts.tags.join(","));
  const qs = q.toString();
  return request(`/api/stats/timeline${qs ? `?${qs}` : ""}`);
}

/** A stone in the relationship graph: display bits + 苔片 count in the period. */
export type GraphNode = { id: string; name: string; color: string | null; count: number };

/** A bridge: the two stones' ids (`a` < `b`) and how many 苔片 carry both tags. */
export type GraphEdge = { a: string; b: string; count: number };

/** The server owns the order: nodes and edges both come count-descending. */
export type TagGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

/** 今月 / 今年 / 全期間 (visualization.md §6). The boundary is cut server-side in APP_TZ. */
export type GraphPeriod = "month" | "year" | "all";

export function getGraph(period: GraphPeriod): Promise<TagGraph> {
  return request(period === "all" ? "/api/stats/graph" : `/api/stats/graph?period=${period}`);
}
